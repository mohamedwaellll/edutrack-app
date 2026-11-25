-- =========================================================================
-- EduTrack Stage F.2 Migration (2026-11-24)
-- Assignments Phase 2: Student Text Submissions & Teacher Submissions View
--
-- Security, Scope & Integrity Guarantees:
-- 1. Enforces a single submission per (assignment_id, student_id) via a
--    database UNIQUE constraint.
-- 2. Student identity (student_id) is ALWAYS derived server-side from:
--      auth.uid() -> public.profiles (role = 'student') -> public.students.user_id
-- 3. At every save inside the transaction, FOR SHARE locks verify that:
--    - Student is linked, active, and belongs to the assignment's group.
--    - Database clock NOW() < assignment.due_at (rejects at or after due_at).
-- 4. Duplicate rapid requests or edits before due_at UPSERT the single row
--    without creating duplicates.
-- 5. Teacher reads derive teacher_id from auth.uid() and verify at every
--    read that the assignment's group is STILL assigned to that teacher.
-- 6. Student reads return ONLY the authenticated student's own submission,
--    even if another student in the same group shares the same name.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.assignment_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL CHECK (char_length(btrim(answer_text)) > 0),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_assignment_submission_student UNIQUE (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment_updated
  ON public.assignment_submissions (assignment_id, updated_at DESC);

ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.assignment_submissions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignment_submissions TO authenticated;

DROP POLICY IF EXISTS assignment_submissions_admin_all ON public.assignment_submissions;
CREATE POLICY assignment_submissions_admin_all
  ON public.assignment_submissions
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS assignment_submissions_student_select ON public.assignment_submissions;
CREATE POLICY assignment_submissions_student_select
  ON public.assignment_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.students s ON s.user_id = p.id
      WHERE p.id = auth.uid()
        AND p.role = 'student'
        AND s.id = assignment_submissions.student_id
    )
  );

DROP POLICY IF EXISTS assignment_submissions_teacher_select ON public.assignment_submissions;
CREATE POLICY assignment_submissions_teacher_select
  ON public.assignment_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.teachers t ON t.user_id = p.id
      JOIN public.groups g ON g.teacher_id = t.id
      JOIN public.assignments a ON a.group_id = g.id
      WHERE p.id = auth.uid()
        AND p.role = 'teacher'
        AND a.id = assignment_submissions.assignment_id
    )
  );

-- 1. Student RPC: Submit or edit text answer before due_at (server clock)
CREATE OR REPLACE FUNCTION public.submit_student_assignment(
  p_assignment_id UUID,
  p_answer_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_student RECORD;
  v_assignment RECORD;
  v_clean_answer TEXT;
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

  IF NOT FOUND OR v_profile_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Access denied: Verified student profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT id, group_id, status
  INTO v_student
  FROM public.students
  WHERE user_id = v_uid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Your account is not linked to a student record.' USING ERRCODE = '42501';
  END IF;

  IF v_student.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Access denied: Only active students can submit assignments.' USING ERRCODE = '42501';
  END IF;

  IF v_student.group_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: You are not assigned to a class group.' USING ERRCODE = '42501';
  END IF;

  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Assignment is required.';
  END IF;

  SELECT id, group_id, due_at
  INTO v_assignment
  FROM public.assignments
  WHERE id = p_assignment_id
  FOR SHARE;

  IF NOT FOUND OR v_assignment.group_id IS DISTINCT FROM v_student.group_id THEN
    RAISE EXCEPTION 'Access denied: This assignment does not belong to your current group.' USING ERRCODE = '42501';
  END IF;

  IF NOW() >= v_assignment.due_at THEN
    RAISE EXCEPTION 'Submission deadline has passed.';
  END IF;

  v_clean_answer := btrim(COALESCE(p_answer_text, ''));
  IF v_clean_answer = '' THEN
    RAISE EXCEPTION 'Answer text is required.';
  END IF;

  INSERT INTO public.assignment_submissions (
    assignment_id,
    student_id,
    answer_text,
    submitted_at,
    updated_at
  )
  VALUES (
    v_assignment.id,
    v_student.id,
    v_clean_answer,
    NOW(),
    NOW()
  )
  ON CONFLICT (assignment_id, student_id)
  DO UPDATE SET
    answer_text = EXCLUDED.answer_text,
    updated_at = NOW()
  RETURNING id, assignment_id, student_id, answer_text, submitted_at, updated_at
  INTO v_saved;

  RETURN jsonb_build_object(
    'submission',
    jsonb_build_object(
      'id', v_saved.id,
      'assignment_id', v_saved.assignment_id,
      'answer_text', v_saved.answer_text,
      'submitted_at', v_saved.submitted_at,
      'updated_at', v_saved.updated_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_student_assignment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_student_assignment(UUID, TEXT) TO authenticated;

-- 2. Update Student Assignments Read RPC to include server-evaluated is_past_due and ONLY this student's submission
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
  WHERE a.group_id = v_student.group_id;

  RETURN jsonb_build_object(
    'linked', TRUE,
    'assignments', v_assignments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_assignments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_assignments() TO authenticated;

-- 3. Teacher RPC: Read student submissions for an assignment in an assigned group
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
        'updated_at', sub.updated_at
      )
      ORDER BY sub.updated_at DESC, s.full_name ASC, sub.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_submissions
  FROM public.assignment_submissions sub
  JOIN public.students s ON s.id = sub.student_id
  WHERE sub.assignment_id = v_assignment.id;

  RETURN jsonb_build_object(
    'assignment',
    jsonb_build_object(
      'id', v_assignment.id,
      'title', v_assignment.title,
      'group_id', v_assignment.group_id,
      'group_name', v_assignment.group_name,
      'due_at', v_assignment.due_at
    ),
    'submissions', v_submissions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_assignment_submissions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_assignment_submissions(UUID) TO authenticated;
