-- =========================================================================
-- EduTrack Stage F.3 Migration (2026-11-24)
-- Assignments Phase 3: Grading Submissions -> Grades Ledger & Parent Visibility
--
-- Security, Atomicity & Integrity Guarantees:
-- 1. Links assignment grades directly to `public.assignment_submissions(id)` via
--    `public.grades.assignment_submission_id` with a UNIQUE constraint.
-- 2. Manual grades (`assignment_submission_id IS NULL`) remain untouched.
-- 3. Grading is allowed ONLY after `NOW() >= assignment.due_at` (DB clock)
--    and ONLY when the assignment's group is STILL assigned to the teacher.
-- 4. First save inserts a single `grade_type = 'assignment'` row deriving
--    student_id, group_id, assessment_title from the submission/assignment and
--    teacher_id from `auth.uid()`. Subsequent saves UPDATE that exact same row.
-- 5. Optimistic concurrency check (`p_expected_grade_updated_at`) prevents stale
--    multi-tab overwrites and returns `{ saved: false, conflict: true, grade }`.
-- 6. Student answer text remains strictly scoped to Student & Teacher portals;
--    Parent portal sees ONLY the resulting grade in `get_parent_child_details()`.
-- =========================================================================

ALTER TABLE public.grades
  ADD COLUMN IF NOT EXISTS assignment_submission_id UUID REFERENCES public.assignment_submissions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_grades_assignment_submission'
      AND conrelid = 'public.grades'::regclass
  ) THEN
    ALTER TABLE public.grades
      ADD CONSTRAINT uq_grades_assignment_submission UNIQUE (assignment_submission_id);
  END IF;
END $$;

-- Update validate_grade_record() trigger function to also allow scoped assignment grade UPDATEs
CREATE OR REPLACE FUNCTION public.validate_grade_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_caller_role TEXT;
  v_is_admin_or_maint BOOLEAN := FALSE;
  v_is_scoped_teacher BOOLEAN := FALSE;
  v_uid UUID;
  v_profile_role public.user_role;
  v_linked_teacher_id UUID;
  v_group_teacher_id UUID;
  student_group UUID;
  student_status TEXT;
BEGIN
  v_caller_role := COALESCE(NULLIF(NULLIF(current_setting('role', true), 'none'), ''), session_user);
  v_is_admin_or_maint := (
    v_caller_role IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(public.is_admin(), FALSE) = TRUE
  );

  IF NOT v_is_admin_or_maint THEN
    IF (
      (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.assignment_submission_id IS NOT NULL AND OLD.assignment_submission_id = NEW.assignment_submission_id))
      AND current_setting('edutrack.teacher_portal_write', true) = '1'
    ) THEN
      v_uid := auth.uid();
      IF v_uid IS NOT NULL THEN
        SELECT role INTO v_profile_role
        FROM public.profiles
        WHERE id = v_uid
        FOR SHARE;

        IF FOUND AND v_profile_role = 'teacher' THEN
          SELECT id INTO v_linked_teacher_id
          FROM public.teachers
          WHERE user_id = v_uid
          FOR SHARE;

          IF FOUND AND NEW.teacher_id IS NOT NULL AND NEW.teacher_id = v_linked_teacher_id THEN
            SELECT teacher_id INTO v_group_teacher_id
            FROM public.groups
            WHERE id = NEW.group_id
            FOR SHARE;

            IF FOUND AND v_group_teacher_id = v_linked_teacher_id THEN
              v_is_scoped_teacher := TRUE;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    IF NOT v_is_scoped_teacher THEN
      RAISE EXCEPTION 'Unauthorized: Only administrators or assigned teachers can save assessments or feedback'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.assessment_title IS NULL OR btrim(NEW.assessment_title) = '' THEN
    RAISE EXCEPTION 'Assessment title is required';
  END IF;

  IF NEW.score IS NULL OR NEW.max_score IS NULL OR NOT (
    NEW.max_score > 0 AND NEW.max_score < 1000 AND NEW.score >= 0 AND NEW.score <= NEW.max_score
  ) THEN
    RAISE EXCEPTION 'Invalid score: expected 0 <= score <= maximum, with 0 < maximum < 1000';
  END IF;

  IF NEW.assessment_date IS NULL OR NEW.assessment_date > (NOW() AT TIME ZONE 'Africa/Cairo')::DATE THEN
    RAISE EXCEPTION 'Assessment date must not be in the future';
  END IF;

  IF NEW.assignment_submission_id IS NULL THEN
    -- Manual assessments require the student to belong to the group and be active.
    SELECT group_id, status INTO student_group, student_status
    FROM public.students
    WHERE id = NEW.student_id
    FOR SHARE;

    IF NOT FOUND OR student_group IS NULL OR NEW.group_id IS DISTINCT FROM student_group THEN
      RAISE EXCEPTION 'Student must belong to the selected group';
    END IF;

    IF student_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Only active students can receive new assessments';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.group_id IS DISTINCT FROM OLD.group_id THEN
      RAISE EXCEPTION 'Cannot reassign student or group on an existing assignment grade';
    END IF;
  END IF;

  NEW.assessment_title := btrim(NEW.assessment_title);
  RETURN NEW;
END;
$$;

-- 1. Teacher RPC: Grade or re-grade a submitted assignment after due_at
CREATE OR REPLACE FUNCTION public.grade_assignment_submission(
  p_submission_id UUID,
  p_score NUMERIC,
  p_max_score NUMERIC,
  p_expected_grade_updated_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_teacher RECORD;
  v_sub RECORD;
  v_existing RECORD;
  v_saved RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_profile_role
  FROM public.profiles
  WHERE id = v_uid
  FOR SHARE;

  IF NOT FOUND OR v_profile_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Access denied: Verified teacher profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT id, full_name INTO v_teacher
  FROM public.teachers
  WHERE user_id = v_uid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Your account is not linked to a teacher profile.' USING ERRCODE = '42501';
  END IF;

  IF p_submission_id IS NULL THEN
    RAISE EXCEPTION 'Submission is required.';
  END IF;

  SELECT
    sub.id,
    sub.assignment_id,
    sub.student_id,
    a.title AS assignment_title,
    a.group_id,
    a.due_at,
    g.teacher_id AS group_teacher_id
  INTO v_sub
  FROM public.assignment_submissions sub
  JOIN public.assignments a ON a.id = sub.assignment_id
  JOIN public.groups g ON g.id = a.group_id
  WHERE sub.id = p_submission_id
  FOR SHARE;

  IF NOT FOUND OR v_sub.group_teacher_id IS DISTINCT FROM v_teacher.id THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  IF NOW() < v_sub.due_at THEN
    RAISE EXCEPTION 'Grading is only available after the assignment due date has passed.';
  END IF;

  IF p_score IS NULL OR p_max_score IS NULL OR NOT (
    p_max_score > 0 AND p_max_score < 1000 AND p_score >= 0 AND p_score <= p_max_score
  ) THEN
    RAISE EXCEPTION 'Invalid score: expected 0 <= score <= maximum, with 0 < maximum < 1000';
  END IF;

  SELECT id, score, max_score, assessment_date, updated_at
  INTO v_existing
  FROM public.grades
  WHERE assignment_submission_id = v_sub.id
  FOR UPDATE;

  IF FOUND THEN
    IF p_expected_grade_updated_at IS NULL
       OR date_trunc('milliseconds', v_existing.updated_at) IS DISTINCT FROM date_trunc('milliseconds', p_expected_grade_updated_at) THEN
      RETURN jsonb_build_object(
        'saved', FALSE,
        'conflict', TRUE,
        'grade', jsonb_build_object(
          'id', v_existing.id,
          'score', v_existing.score,
          'max_score', v_existing.max_score,
          'assessment_date', v_existing.assessment_date,
          'updated_at', v_existing.updated_at
        )
      );
    END IF;

    PERFORM set_config('edutrack.teacher_portal_write', '1', true);

    UPDATE public.grades
    SET
      teacher_id = v_teacher.id,
      score = p_score,
      max_score = p_max_score,
      updated_at = NOW()
    WHERE id = v_existing.id
    RETURNING id, score, max_score, assessment_date, updated_at
    INTO v_saved;
  ELSE
    IF p_expected_grade_updated_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'saved', FALSE,
        'conflict', TRUE,
        'grade', NULL
      );
    END IF;

    PERFORM set_config('edutrack.teacher_portal_write', '1', true);

    INSERT INTO public.grades (
      student_id,
      group_id,
      teacher_id,
      assessment_title,
      grade_type,
      score,
      max_score,
      assessment_date,
      assignment_submission_id,
      updated_at
    )
    VALUES (
      v_sub.student_id,
      v_sub.group_id,
      v_teacher.id,
      v_sub.assignment_title,
      'assignment'::public.grade_category,
      p_score,
      p_max_score,
      (NOW() AT TIME ZONE 'Africa/Cairo')::DATE,
      v_sub.id,
      NOW()
    )
    RETURNING id, score, max_score, assessment_date, updated_at
    INTO v_saved;
  END IF;

  RETURN jsonb_build_object(
    'saved', TRUE,
    'conflict', FALSE,
    'grade', jsonb_build_object(
      'id', v_saved.id,
      'score', v_saved.score,
      'max_score', v_saved.max_score,
      'assessment_date', v_saved.assessment_date,
      'updated_at', v_saved.updated_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grade_assignment_submission(UUID, NUMERIC, NUMERIC, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_assignment_submission(UUID, NUMERIC, NUMERIC, TIMESTAMPTZ) TO authenticated;

-- 2. Update get_teacher_assignment_submissions to include `can_grade` and linked `grade`
CREATE OR REPLACE FUNCTION public.get_teacher_assignment_submissions(p_assignment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_teacher_id UUID;
  v_assignment RECORD;
  v_submissions JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_profile_role
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND OR v_profile_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Access denied: Verified teacher profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_teacher_id
  FROM public.teachers
  WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Your account is not linked to a teacher profile.' USING ERRCODE = '42501';
  END IF;

  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Assignment is required.';
  END IF;

  SELECT
    a.id,
    a.title,
    a.group_id,
    a.due_at,
    g.name AS group_name,
    g.teacher_id AS group_teacher_id
  INTO v_assignment
  FROM public.assignments a
  JOIN public.groups g ON g.id = a.group_id
  WHERE a.id = p_assignment_id;

  IF NOT FOUND OR v_assignment.group_teacher_id IS DISTINCT FROM v_teacher_id THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sub.id,
        'assignment_id', sub.assignment_id,
        'student_id', s.id,
        'student_name', s.full_name,
        'student_code', s.student_code,
        'answer_text', sub.answer_text,
        'submitted_at', sub.submitted_at,
        'updated_at', sub.updated_at,
        'grade', CASE
          WHEN gr.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', gr.id,
            'score', gr.score,
            'max_score', gr.max_score,
            'assessment_date', gr.assessment_date,
            'updated_at', gr.updated_at
          )
        END
      )
      ORDER BY sub.updated_at DESC, s.full_name ASC, sub.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_submissions
  FROM public.assignment_submissions sub
  JOIN public.students s ON s.id = sub.student_id
  LEFT JOIN public.grades gr ON gr.assignment_submission_id = sub.id
  WHERE sub.assignment_id = v_assignment.id;

  RETURN jsonb_build_object(
    'assignment',
    jsonb_build_object(
      'id', v_assignment.id,
      'title', v_assignment.title,
      'group_id', v_assignment.group_id,
      'group_name', v_assignment.group_name,
      'due_at', v_assignment.due_at,
      'can_grade', (NOW() >= v_assignment.due_at)
    ),
    'submissions', v_submissions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_assignment_submissions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_assignment_submissions(UUID) TO authenticated;

-- 3. Update get_student_assignments to include linked `grade` for the student's submission
CREATE OR REPLACE FUNCTION public.get_student_assignments()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_student RECORD;
  v_assignments JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_profile_role
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND OR v_profile_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Access denied: Verified student profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT
    s.id,
    s.group_id,
    g.name AS group_name
  INTO v_student
  FROM public.students s
  LEFT JOIN public.groups g ON g.id = s.group_id
  WHERE s.user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'linked', FALSE,
      'assignments', '[]'::jsonb
    );
  END IF;

  IF v_student.group_id IS NULL THEN
    RETURN jsonb_build_object(
      'linked', TRUE,
      'assignments', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'group_id', a.group_id,
        'group_name', COALESCE(v_student.group_name, ''),
        'title', a.title,
        'instructions', a.instructions,
        'due_at', a.due_at,
        'created_at', a.created_at,
        'is_past_due', (NOW() >= a.due_at),
        'submission', CASE
          WHEN sub.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', sub.id,
            'answer_text', sub.answer_text,
            'submitted_at', sub.submitted_at,
            'updated_at', sub.updated_at
          )
        END,
        'grade', CASE
          WHEN gr.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', gr.id,
            'score', gr.score,
            'max_score', gr.max_score,
            'assessment_date', gr.assessment_date,
            'updated_at', gr.updated_at
          )
        END
      )
      ORDER BY a.due_at ASC, a.created_at DESC, a.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_assignments
  FROM public.assignments a
  LEFT JOIN public.assignment_submissions sub
    ON sub.assignment_id = a.id
   AND sub.student_id = v_student.id
  LEFT JOIN public.grades gr
    ON gr.assignment_submission_id = sub.id
  WHERE a.group_id = v_student.group_id;

  RETURN jsonb_build_object(
    'linked', TRUE,
    'assignments', v_assignments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_assignments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_assignments() TO authenticated;
