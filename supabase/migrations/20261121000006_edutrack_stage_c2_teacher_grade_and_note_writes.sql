-- =========================================================================
-- EduTrack Stage C.2 Migration (2026-11-21)
-- Scoped Teacher Grade & Feedback Writes + Scoped Record Reads
--
-- Migration Order & Precedence:
-- 1. Must run strictly AFTER:
--    20261121000005_edutrack_stage_c1_teacher_read_only_scope.sql
--
-- Security, Atomicity & Integrity Guarantees:
-- 1. Author identity (teacher_id) is ALWAYS derived server-side from:
--      auth.uid() -> public.profiles (role = 'teacher') -> public.teachers.user_id
--    No client-supplied teacher_id is accepted by teacher portal RPCs.
-- 2. At save time inside the same transaction, FOR SHARE locks serialize against
--    concurrent account unlink/role edits, group reassignment, student transfer,
--    and student status changes before validating and inserting the record.
-- 3. validate_grade_record() and validate_teacher_note() preserve admin/maintenance
--    paths and add a narrow INSERT-only scoped teacher path guarded by
--    transaction-local GUC edutrack.teacher_portal_write + full ownership checks.
-- 4. Direct INSERT/UPDATE/DELETE/SELECT on public.grades and public.teacher_notes
--    remain locked behind administrator-only RLS (public.is_admin()).
-- 5. get_teacher_student_records(p_group_id, p_student_id) returns ONLY records
--    authored by the currently authenticated teacher for a student currently in
--    a group currently assigned to that teacher. When a group is reassigned,
--    existing records remain preserved under their original author's teacher_id.
-- =========================================================================

-- 1. Update validate_grade_record() trigger function to support narrow teacher-portal INSERTs
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
    IF TG_OP = 'INSERT' AND current_setting('edutrack.teacher_portal_write', true) = '1' THEN
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

  -- Lock the student until the write completes, preventing concurrent reassignment.
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

  NEW.assessment_title := btrim(NEW.assessment_title);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_grade_record ON public.grades;
CREATE TRIGGER tr_validate_grade_record
BEFORE INSERT OR UPDATE ON public.grades
FOR EACH ROW
EXECUTE FUNCTION public.validate_grade_record();

-- 2. Update validate_teacher_note() trigger function to support narrow teacher-portal INSERTs
CREATE OR REPLACE FUNCTION public.validate_teacher_note()
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

  SELECT group_id, status INTO student_group, student_status
  FROM public.students
  WHERE id = NEW.student_id
  FOR SHARE;

  IF NOT FOUND OR student_group IS NULL OR student_status IS DISTINCT FROM 'active' THEN
    IF NOT v_is_admin_or_maint AND TG_OP = 'INSERT' AND current_setting('edutrack.teacher_portal_write', true) = '1' THEN
      -- Check authorization failure first if unauthenticated/wrong role so unauthorized callers get 42501
      NULL;
    ELSE
      RAISE EXCEPTION 'Feedback requires an active student assigned to a group';
    END IF;
  END IF;

  IF NOT v_is_admin_or_maint THEN
    IF TG_OP = 'INSERT' AND current_setting('edutrack.teacher_portal_write', true) = '1' THEN
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

          IF FOUND AND NEW.teacher_id IS NOT NULL AND NEW.teacher_id = v_linked_teacher_id AND student_group IS NOT NULL THEN
            SELECT teacher_id INTO v_group_teacher_id
            FROM public.groups
            WHERE id = student_group
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

    IF student_group IS NULL OR student_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Feedback requires an active student assigned to a group';
    END IF;
  END IF;

  IF NEW.feedback_text IS NULL OR btrim(NEW.feedback_text) = '' THEN
    RAISE EXCEPTION 'Feedback text is required';
  END IF;

  IF NEW.is_parent_visible IS NULL THEN
    RAISE EXCEPTION 'Feedback visibility is required';
  END IF;

  NEW.feedback_text := btrim(NEW.feedback_text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_teacher_note ON public.teacher_notes;
CREATE TRIGGER tr_validate_teacher_note
BEFORE INSERT OR UPDATE ON public.teacher_notes
FOR EACH ROW
EXECUTE FUNCTION public.validate_teacher_note();

REVOKE ALL ON FUNCTION public.validate_grade_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_teacher_note() FROM PUBLIC, anon, authenticated;

-- 3. Scoped Read RPC: returns ONLY the authenticated teacher's own grades & notes
--    for a student currently belonging to a group currently assigned to that teacher
CREATE OR REPLACE FUNCTION public.get_teacher_student_records(
  p_group_id UUID,
  p_student_id UUID
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
  v_group RECORD;
  v_student RECORD;
  v_grades JSONB;
  v_notes JSONB;
BEGIN
  IF p_group_id IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'Group ID and student ID are required.' USING ERRCODE = '22023';
  END IF;

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

  SELECT id, full_name INTO v_teacher
  FROM public.teachers
  WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Authenticated user is not linked to a teacher record.' USING ERRCODE = '42501';
  END IF;

  SELECT id, name, grade_level INTO v_group
  FROM public.groups
  WHERE id = p_group_id
    AND teacher_id = v_teacher.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Group is not assigned to the authenticated teacher.' USING ERRCODE = '42501';
  END IF;

  SELECT id, full_name, student_code, status, group_id INTO v_student
  FROM public.students
  WHERE id = p_student_id
    AND group_id = v_group.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Student does not belong to the selected assigned group.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'student_id', g.student_id,
        'group_id', g.group_id,
        'teacher_id', g.teacher_id,
        'author_name', v_teacher.full_name,
        'assessment_title', g.assessment_title,
        'grade_type', g.grade_type,
        'score', g.score,
        'max_score', g.max_score,
        'assessment_date', g.assessment_date,
        'remarks', g.remarks,
        'created_at', g.created_at
      )
      ORDER BY g.assessment_date DESC, g.created_at DESC, g.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_grades
  FROM public.grades g
  WHERE g.student_id = v_student.id
    AND g.group_id = v_group.id
    AND g.teacher_id = v_teacher.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', tn.id,
        'student_id', tn.student_id,
        'teacher_id', tn.teacher_id,
        'author_name', v_teacher.full_name,
        'feedback_text', tn.feedback_text,
        'is_parent_visible', tn.is_parent_visible,
        'note_date', (tn.created_at AT TIME ZONE 'Africa/Cairo')::DATE,
        'created_at', tn.created_at
      )
      ORDER BY tn.created_at DESC, tn.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_notes
  FROM public.teacher_notes tn
  WHERE tn.student_id = v_student.id
    AND tn.teacher_id = v_teacher.id;

  RETURN jsonb_build_object(
    'student', jsonb_build_object(
      'id', v_student.id,
      'full_name', v_student.full_name,
      'student_code', v_student.student_code,
      'status', v_student.status,
      'group_id', v_student.group_id
    ),
    'grades', v_grades,
    'notes', v_notes
  );
END;
$$;

-- 4. Atomic Scoped Grade Creation RPC
CREATE OR REPLACE FUNCTION public.save_teacher_student_grade(
  p_group_id UUID,
  p_student_id UUID,
  p_assessment_title TEXT,
  p_grade_type public.grade_category,
  p_score NUMERIC,
  p_max_score NUMERIC,
  p_assessment_date DATE,
  p_notes TEXT DEFAULT NULL
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
  v_group RECORD;
  v_student RECORD;
  v_inserted public.grades%ROWTYPE;
BEGIN
  IF p_group_id IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'Group ID and student ID are required.' USING ERRCODE = '22023';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- Lock profile, teacher link, group assignment, and student status/membership in consistent order
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
    RAISE EXCEPTION 'Access denied: Authenticated user is not linked to a teacher record.' USING ERRCODE = '42501';
  END IF;

  SELECT id, teacher_id INTO v_group
  FROM public.groups
  WHERE id = p_group_id
  FOR SHARE;

  IF NOT FOUND OR v_group.teacher_id IS DISTINCT FROM v_teacher.id THEN
    RAISE EXCEPTION 'Access denied: Group is not currently assigned to the authenticated teacher.' USING ERRCODE = '42501';
  END IF;

  SELECT id, group_id, status INTO v_student
  FROM public.students
  WHERE id = p_student_id
  FOR SHARE;

  IF NOT FOUND OR v_student.group_id IS DISTINCT FROM v_group.id THEN
    RAISE EXCEPTION 'Access denied: Student does not currently belong to the selected group.' USING ERRCODE = '42501';
  END IF;

  IF v_student.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Only active students can receive new assessments.';
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
    remarks
  )
  VALUES (
    v_student.id,
    v_group.id,
    v_teacher.id,
    btrim(COALESCE(p_assessment_title, '')),
    COALESCE(p_grade_type, 'exam'::public.grade_category),
    p_score,
    p_max_score,
    p_assessment_date,
    NULLIF(btrim(COALESCE(p_notes, '')), '')
  )
  RETURNING * INTO v_inserted;
  PERFORM set_config('edutrack.teacher_portal_write', '0', true);

  RETURN jsonb_build_object(
    'grade', jsonb_build_object(
      'id', v_inserted.id,
      'student_id', v_inserted.student_id,
      'group_id', v_inserted.group_id,
      'teacher_id', v_inserted.teacher_id,
      'author_name', v_teacher.full_name,
      'assessment_title', v_inserted.assessment_title,
      'grade_type', v_inserted.grade_type,
      'score', v_inserted.score,
      'max_score', v_inserted.max_score,
      'assessment_date', v_inserted.assessment_date,
      'remarks', v_inserted.remarks,
      'created_at', v_inserted.created_at
    )
  );
END;
$$;

-- 5. Atomic Scoped Teacher Note Creation RPC
CREATE OR REPLACE FUNCTION public.save_teacher_student_note(
  p_group_id UUID,
  p_student_id UUID,
  p_feedback_text TEXT,
  p_is_parent_visible BOOLEAN DEFAULT FALSE
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
  v_group RECORD;
  v_student RECORD;
  v_inserted public.teacher_notes%ROWTYPE;
BEGIN
  IF p_group_id IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'Group ID and student ID are required.' USING ERRCODE = '22023';
  END IF;

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
    RAISE EXCEPTION 'Access denied: Authenticated user is not linked to a teacher record.' USING ERRCODE = '42501';
  END IF;

  SELECT id, teacher_id INTO v_group
  FROM public.groups
  WHERE id = p_group_id
  FOR SHARE;

  IF NOT FOUND OR v_group.teacher_id IS DISTINCT FROM v_teacher.id THEN
    RAISE EXCEPTION 'Access denied: Group is not currently assigned to the authenticated teacher.' USING ERRCODE = '42501';
  END IF;

  SELECT id, group_id, status INTO v_student
  FROM public.students
  WHERE id = p_student_id
  FOR SHARE;

  IF NOT FOUND OR v_student.group_id IS DISTINCT FROM v_group.id THEN
    RAISE EXCEPTION 'Access denied: Student does not currently belong to the selected group.' USING ERRCODE = '42501';
  END IF;

  IF v_student.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Feedback requires an active student assigned to a group.';
  END IF;

  PERFORM set_config('edutrack.teacher_portal_write', '1', true);
  INSERT INTO public.teacher_notes (
    teacher_id,
    student_id,
    feedback_text,
    is_parent_visible
  )
  VALUES (
    v_teacher.id,
    v_student.id,
    btrim(COALESCE(p_feedback_text, '')),
    COALESCE(p_is_parent_visible, FALSE)
  )
  RETURNING * INTO v_inserted;
  PERFORM set_config('edutrack.teacher_portal_write', '0', true);

  RETURN jsonb_build_object(
    'note', jsonb_build_object(
      'id', v_inserted.id,
      'student_id', v_inserted.student_id,
      'teacher_id', v_inserted.teacher_id,
      'author_name', v_teacher.full_name,
      'feedback_text', v_inserted.feedback_text,
      'is_parent_visible', v_inserted.is_parent_visible,
      'note_date', (v_inserted.created_at AT TIME ZONE 'Africa/Cairo')::DATE,
      'created_at', v_inserted.created_at
    )
  );
END;
$$;

-- 6. Least-privilege EXECUTE grants (authenticated only, revoked from PUBLIC/anon)
REVOKE ALL ON FUNCTION public.get_teacher_student_records(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_student_records(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.save_teacher_student_grade(UUID, UUID, TEXT, public.grade_category, NUMERIC, NUMERIC, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_teacher_student_grade(UUID, UUID, TEXT, public.grade_category, NUMERIC, NUMERIC, DATE, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.save_teacher_student_note(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_teacher_student_note(UUID, UUID, TEXT, BOOLEAN) TO authenticated;
