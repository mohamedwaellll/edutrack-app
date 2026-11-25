-- =========================================================================
-- EduTrack Stage F.1 Migration (2026-11-24)
-- Assignments Phase 1: Teacher Publish + Student Read-Only Portal
--
-- Security, Scope & Integrity Guarantees:
-- 1. Separate `public.assignments` entity isolated from `public.grades` and
--    `public.teacher_notes`.
-- 2. Teacher identity (`teacher_id`) is ALWAYS derived server-side from:
--      auth.uid() -> public.profiles (role = 'teacher') -> public.teachers.user_id
-- 3. At publish time inside the transaction, FOR SHARE locks verify that the
--    target group is STILL assigned to the authenticated teacher (preventing
--    stale form submissions after group reassignment).
-- 4. Student reads are scoped strictly to the linked student's CURRENT
--    `students.group_id` via `students.user_id = auth.uid()`.
-- 5. `due_at` is stored as TIMESTAMPTZ preserving the exact instant in time
--    and rendered in Africa/Cairo timezone in both portals.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) > 0),
  instructions TEXT NOT NULL CHECK (char_length(btrim(instructions)) > 0),
  due_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_group_due_at
  ON public.assignments (group_id, due_at ASC, created_at DESC);

ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.assignments FROM anon, authenticated;
GRANT SELECT ON public.assignments TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.assignments TO authenticated;

DROP POLICY IF EXISTS assignments_admin_all ON public.assignments;
CREATE POLICY assignments_admin_all
  ON public.assignments
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS assignments_teacher_select ON public.assignments;
CREATE POLICY assignments_teacher_select
  ON public.assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.teachers t ON t.user_id = p.id
      JOIN public.groups g ON g.teacher_id = t.id
      WHERE p.id = auth.uid()
        AND p.role = 'teacher'
        AND g.id = assignments.group_id
    )
  );

DROP POLICY IF EXISTS assignments_student_select ON public.assignments;
CREATE POLICY assignments_student_select
  ON public.assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.students s ON s.user_id = p.id
      WHERE p.id = auth.uid()
        AND p.role = 'student'
        AND s.group_id = assignments.group_id
    )
  );

-- 1. Teacher RPC: Publish an assignment to an assigned group
CREATE OR REPLACE FUNCTION public.create_teacher_assignment(
  p_group_id UUID,
  p_title TEXT,
  p_instructions TEXT,
  p_due_at TIMESTAMPTZ
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
  v_clean_title TEXT;
  v_clean_instructions TEXT;
  v_inserted RECORD;
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

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'Group is required.';
  END IF;

  SELECT id, name, teacher_id INTO v_group
  FROM public.groups
  WHERE id = p_group_id
  FOR SHARE;

  IF NOT FOUND OR v_group.teacher_id IS DISTINCT FROM v_teacher.id THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  v_clean_title := btrim(COALESCE(p_title, ''));
  IF v_clean_title = '' THEN
    RAISE EXCEPTION 'Assignment title is required.';
  END IF;

  v_clean_instructions := btrim(COALESCE(p_instructions, ''));
  IF v_clean_instructions = '' THEN
    RAISE EXCEPTION 'Assignment instructions are required.';
  END IF;

  IF p_due_at IS NULL OR p_due_at <= NOW() THEN
    RAISE EXCEPTION 'Due date and time must be in the future.';
  END IF;

  INSERT INTO public.assignments (
    group_id,
    teacher_id,
    title,
    instructions,
    due_at
  )
  VALUES (
    v_group.id,
    v_teacher.id,
    v_clean_title,
    v_clean_instructions,
    p_due_at
  )
  RETURNING id, group_id, teacher_id, title, instructions, due_at, created_at
  INTO v_inserted;

  RETURN jsonb_build_object(
    'assignment',
    jsonb_build_object(
      'id', v_inserted.id,
      'group_id', v_inserted.group_id,
      'group_name', v_group.name,
      'teacher_id', v_inserted.teacher_id,
      'teacher_name', v_teacher.full_name,
      'title', v_inserted.title,
      'instructions', v_inserted.instructions,
      'due_at', v_inserted.due_at,
      'created_at', v_inserted.created_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_teacher_assignment(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_teacher_assignment(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- 2. Teacher RPC: Read published assignments for an assigned group
CREATE OR REPLACE FUNCTION public.get_teacher_assignments(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_teacher_id UUID;
  v_group RECORD;
  v_assignments JSONB;
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

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'Group is required.';
  END IF;

  SELECT id, name, teacher_id INTO v_group
  FROM public.groups
  WHERE id = p_group_id;

  IF NOT FOUND OR v_group.teacher_id IS DISTINCT FROM v_teacher_id THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'group_id', a.group_id,
        'group_name', v_group.name,
        'teacher_id', a.teacher_id,
        'teacher_name', COALESCE(t.full_name, 'Teacher'),
        'title', a.title,
        'instructions', a.instructions,
        'due_at', a.due_at,
        'created_at', a.created_at
      )
      ORDER BY a.due_at ASC, a.created_at DESC, a.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_assignments
  FROM public.assignments a
  LEFT JOIN public.teachers t ON t.id = a.teacher_id
  WHERE a.group_id = p_group_id;

  RETURN jsonb_build_object('assignments', v_assignments);
END;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_assignments(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_assignments(UUID) TO authenticated;

-- 3. Student RPC: Read published assignments for the student's current group
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
        'created_at', a.created_at
      )
      ORDER BY a.due_at ASC, a.created_at DESC, a.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_assignments
  FROM public.assignments a
  WHERE a.group_id = v_student.group_id;

  RETURN jsonb_build_object(
    'linked', TRUE,
    'assignments', v_assignments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_assignments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_assignments() TO authenticated;
