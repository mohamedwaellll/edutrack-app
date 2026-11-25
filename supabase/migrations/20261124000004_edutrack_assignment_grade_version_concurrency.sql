-- =========================================================================
-- EduTrack Stage F.4 Migration (2026-11-24)
-- Assignments Phase 4: Row-Level Serialization & Explicit Grade Version
--
-- Security, Concurrency & Integrity Guarantees:
-- 1. Replaces millisecond-truncated `updated_at` optimistic checks with an
--    explicit integer `grade_version` column on `public.grades` (default 1,
--    incremented on every update). Keeps `updated_at` for display.
-- 2. Acquires `FOR UPDATE` directly on the target `public.assignment_submissions`
--    row (scoping the lock strictly to that single submission so grading
--    other submissions proceeds independently without blocking).
-- 3. Guarantees only ONE concurrent request creates the initial grade or
--    updates a given `grade_version`; the losing request observes the committed
--    state and returns `{ saved: false, conflict: true, grade: <latest> }`.
-- =========================================================================

ALTER TABLE public.grades
  ADD COLUMN IF NOT EXISTS grade_version INTEGER NOT NULL DEFAULT 1;

-- Replace the previous 4-arg TIMESTAMPTZ overload cleanly
DROP FUNCTION IF EXISTS public.grade_assignment_submission(UUID, NUMERIC, NUMERIC, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.grade_assignment_submission(
  p_submission_id UUID,
  p_score NUMERIC,
  p_max_score NUMERIC,
  p_expected_grade_version INTEGER DEFAULT NULL
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
  v_assignment RECORD;
  v_group_teacher_id UUID;
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

  -- Lock ONLY this submission row FOR UPDATE to serialize concurrent grading
  -- of the same submission without blocking other submissions.
  SELECT id, assignment_id, student_id
  INTO v_sub
  FROM public.assignment_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  SELECT id, title, group_id, due_at
  INTO v_assignment
  FROM public.assignments
  WHERE id = v_sub.assignment_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  SELECT teacher_id INTO v_group_teacher_id
  FROM public.groups
  WHERE id = v_assignment.group_id
  FOR SHARE;

  IF NOT FOUND OR v_group_teacher_id IS DISTINCT FROM v_teacher.id THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  IF NOW() < v_assignment.due_at THEN
    RAISE EXCEPTION 'Grading is only available after the assignment due date has passed.';
  END IF;

  IF p_score IS NULL OR p_max_score IS NULL OR NOT (
    p_max_score > 0 AND p_max_score < 1000 AND p_score >= 0 AND p_score <= p_max_score
  ) THEN
    RAISE EXCEPTION 'Invalid score: expected 0 <= score <= maximum, with 0 < maximum < 1000';
  END IF;

  SELECT id, score, max_score, assessment_date, updated_at, grade_version
  INTO v_existing
  FROM public.grades
  WHERE assignment_submission_id = v_sub.id
  FOR UPDATE;

  IF FOUND THEN
    IF p_expected_grade_version IS NULL
       OR v_existing.grade_version IS DISTINCT FROM p_expected_grade_version THEN
      RETURN jsonb_build_object(
        'saved', FALSE,
        'conflict', TRUE,
        'grade', jsonb_build_object(
          'id', v_existing.id,
          'score', v_existing.score,
          'max_score', v_existing.max_score,
          'assessment_date', v_existing.assessment_date,
          'updated_at', v_existing.updated_at,
          'grade_version', v_existing.grade_version
        )
      );
    END IF;

    PERFORM set_config('edutrack.teacher_portal_write', '1', true);

    UPDATE public.grades
    SET
      teacher_id = v_teacher.id,
      score = p_score,
      max_score = p_max_score,
      updated_at = NOW(),
      grade_version = v_existing.grade_version + 1
    WHERE id = v_existing.id
    RETURNING id, score, max_score, assessment_date, updated_at, grade_version
    INTO v_saved;
  ELSE
    IF p_expected_grade_version IS NOT NULL THEN
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
      updated_at,
      grade_version
    )
    VALUES (
      v_sub.student_id,
      v_assignment.group_id,
      v_teacher.id,
      v_assignment.title,
      'assignment'::public.grade_category,
      p_score,
      p_max_score,
      (NOW() AT TIME ZONE 'Africa/Cairo')::DATE,
      v_sub.id,
      NOW(),
      1
    )
    RETURNING id, score, max_score, assessment_date, updated_at, grade_version
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
      'updated_at', v_saved.updated_at,
      'grade_version', v_saved.grade_version
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grade_assignment_submission(UUID, NUMERIC, NUMERIC, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_assignment_submission(UUID, NUMERIC, NUMERIC, INTEGER) TO authenticated;

-- Update get_teacher_assignment_submissions to include `grade_version`
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
            'updated_at', gr.updated_at,
            'grade_version', gr.grade_version
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

-- Update get_student_assignments to include `grade_version`
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
            'updated_at', gr.updated_at,
            'grade_version', gr.grade_version
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
