-- =========================================================================
-- EduTrack Stage C.1 Migration (2026-11-21)
-- Scoped Read-Only Teacher Portal RPCs (Assigned Groups & Minimal Student Roster)
--
-- Migration Order & Precedence:
-- 1. Must run strictly AFTER:
--    20261121000004_edutrack_stage_b2_expected_unlink_guards.sql
--
-- Security & Privacy Guarantees:
-- 1. Teacher identity is derived exclusively server-side from:
--      auth.uid() -> public.profiles (role = 'teacher') -> public.teachers.user_id
--    No client-supplied teacher_id is accepted anywhere.
-- 2. Group assignment (public.groups.teacher_id = v_teacher_id) is verified on
--    EVERY group roster read; unassigned, reassigned, or revoked groups fail closed.
-- 3. Student privacy protection:
--    Direct table SELECT policies on public.students, public.groups, and
--    public.teachers remain strictly administrator-only (public.is_admin()).
--    Teacher reads run through least-privilege SECURITY DEFINER RPCs returning ONLY:
--      - Teacher summary: id, full_name, subject
--      - Assigned groups: id, name, grade_level, student_count
--      - Students in group: id, full_name, student_code, status, group_id
--    Parent contact fields (parent_name, parent_phone), qr_code_hash, and
--    user_id are NEVER exposed to teacher accounts.
-- 4. Read-only in Stage C.1: grade and feedback writes stay reserved for Stage C.2.
-- 5. EXECUTE privileges granted exclusively to authenticated (revoked from PUBLIC/anon).
-- =========================================================================

-- 1. Teacher Portal Context RPC: resolves linked teacher record + assigned groups only
CREATE OR REPLACE FUNCTION public.get_teacher_portal_context()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_teacher RECORD;
  v_groups JSONB;
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

  SELECT id, full_name, subject
  INTO v_teacher
  FROM public.teachers
  WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'linked', FALSE,
      'teacher', NULL,
      'groups', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'grade_level', g.grade_level,
        'student_count', (SELECT COUNT(*)::INT FROM public.students s WHERE s.group_id = g.id)
      )
      ORDER BY g.name ASC, g.grade_level ASC, g.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_groups
  FROM public.groups g
  WHERE g.teacher_id = v_teacher.id;

  RETURN jsonb_build_object(
    'linked', TRUE,
    'teacher', jsonb_build_object(
      'id', v_teacher.id,
      'full_name', v_teacher.full_name,
      'subject', v_teacher.subject
    ),
    'groups', v_groups
  );
END;
$$;

-- 2. Scoped Group Students Read RPC: verifies assignment on every read & omits private PII/QR fields
CREATE OR REPLACE FUNCTION public.get_teacher_group_students(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_teacher_id UUID;
  v_group RECORD;
  v_students JSONB;
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'Group ID is required.' USING ERRCODE = '22023';
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

  SELECT id INTO v_teacher_id
  FROM public.teachers
  WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Authenticated user is not linked to a teacher record.' USING ERRCODE = '42501';
  END IF;

  -- Enforce assignment ownership on every roster read
  SELECT id, name, grade_level
  INTO v_group
  FROM public.groups
  WHERE id = p_group_id
    AND teacher_id = v_teacher_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Group is not assigned to the authenticated teacher.' USING ERRCODE = '42501';
  END IF;

  -- Return ONLY non-sensitive roster fields (never parent_name, parent_phone, qr_code_hash, user_id)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'full_name', s.full_name,
        'student_code', s.student_code,
        'status', s.status,
        'group_id', s.group_id
      )
      ORDER BY s.full_name ASC, s.student_code ASC, s.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_students
  FROM public.students s
  WHERE s.group_id = v_group.id;

  RETURN jsonb_build_object(
    'group', jsonb_build_object(
      'id', v_group.id,
      'name', v_group.name,
      'grade_level', v_group.grade_level
    ),
    'students', v_students
  );
END;
$$;

-- 3. Enforce least-privilege EXECUTE permissions
REVOKE ALL ON FUNCTION public.get_teacher_portal_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_portal_context() TO authenticated;

REVOKE ALL ON FUNCTION public.get_teacher_group_students(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_group_students(UUID) TO authenticated;
