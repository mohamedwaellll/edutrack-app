-- =========================================================================
-- EduTrack Stage B.1 Corrective Hardening Migration (2026-11-21)
-- Atomic Account Linking, Student Creation Column Privileges & Lock Coordination
--
-- Migration Order & Precedence:
-- 1. Must run strictly AFTER:
--    20261121000002_edutrack_secure_account_linking.sql
-- 2. Must run strictly BEFORE:
--    Future Stage B.2/B.3 UI linking and role-routing migrations.
--
-- Corrections Applied:
-- 1. Lock down direct students.user_id assignment at student creation:
--    - Revokes table-level INSERT on public.students from authenticated, anon, PUBLIC.
--    - Grants column-level INSERT on public.students excluding user_id to authenticated.
--    - Enforces trigger rejection if TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL.
--    - Preserves normal unlinked student creation by authenticated admins and
--      subsequent linking via link_student_account RPC.
-- 2. Atomic Teacher & Student Link/Unlink RPCs (Eliminates TOCTOU Races):
--    - link_teacher_account / link_student_account use conditional atomic
--      UPDATE ... WHERE id = ... AND user_id IS NULL RETURNING id, user_id
--      and verify the actually modified row before returning success.
--    - Concurrent attempts for the same unlinked record allow only one winner
--      and raise an explicit Conflict error for the losing caller.
--    - unlink_teacher_account / unlink_student_account lock the target row
--      FOR UPDATE, conditionally clear WHERE user_id = v_previous_user_id RETURNING,
--      and verify the cleared row so previous_user_id always matches the actual
--      unlinked account.
-- 3. Profile Role Change & Link Coordination Across Concurrency Interleavings:
--    - Link RPCs and validation triggers acquire FOR SHARE on the target
--      public.profiles row, serializing against non-key role updates.
--    - Adds AFTER UPDATE trigger tr_enforce_profile_role_link_consistency on
--      public.profiles so role-link consistency is enforced strictly after
--      PostgreSQL acquires LockTupleNoKeyExclusive on the profile row,
--      guaranteeing consistency regardless of transaction arrival order while
--      preserving provision_admin and unlink-then-change-role workflows.
-- =========================================================================

-- 1. Close Direct students.user_id Insertion Path (Column-Level Privileges)
REVOKE INSERT ON public.students FROM authenticated, anon, PUBLIC;

GRANT INSERT (
  id,
  full_name,
  student_code,
  group_id,
  grade_level,
  qr_code_hash,
  parent_name,
  parent_phone,
  status,
  created_at
) ON public.students TO authenticated;

-- Re-affirm SELECT privilege on students for authenticated (and none for anon/PUBLIC)
GRANT SELECT ON public.students TO authenticated;
REVOKE ALL ON public.students FROM anon, PUBLIC;

-- 2. Harden Triggers with Direct Creation Lock & Profile Row FOR SHARE Coordination

-- A. Students trigger: block direct user_id on INSERT; coordinate FOR SHARE on UPDATE
CREATE OR REPLACE FUNCTION public.validate_student_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_profile_role public.user_role;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Direct user_id assignment is prohibited during student creation. Account linking is managed separately.';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    IF NEW.user_id IS NOT NULL THEN
      SELECT role INTO v_profile_role
      FROM public.profiles
      WHERE id = NEW.user_id
      FOR SHARE;

      IF NOT FOUND OR v_profile_role <> 'student' THEN
        RAISE EXCEPTION 'students.user_id must reference a valid profile with role student';
      END IF;

      IF EXISTS (SELECT 1 FROM public.students WHERE user_id = NEW.user_id AND id <> NEW.id) THEN
        RAISE EXCEPTION 'User account is already linked to another student record';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_student_user_id ON public.students;
CREATE TRIGGER tr_validate_student_user_id
BEFORE INSERT OR UPDATE ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.validate_student_user_id();

-- B. Teachers trigger: preserve sanitization & INSERT lock; coordinate FOR SHARE on UPDATE
CREATE OR REPLACE FUNCTION public.validate_teacher_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_profile_role public.user_role;
BEGIN
  -- Database enforcement: reject direct user_id assignment on creation
  IF TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Direct user_id assignment is prohibited during teacher creation. Account linking is managed separately.';
  END IF;

  -- User ID link validation on UPDATE with profile FOR SHARE lock
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    IF NEW.user_id IS NOT NULL THEN
      SELECT role INTO v_profile_role
      FROM public.profiles
      WHERE id = NEW.user_id
      FOR SHARE;

      IF NOT FOUND OR v_profile_role <> 'teacher' THEN
        RAISE EXCEPTION 'teachers.user_id must reference a valid profile with role teacher';
      END IF;

      IF EXISTS (SELECT 1 FROM public.teachers WHERE user_id = NEW.user_id AND id <> NEW.id) THEN
        RAISE EXCEPTION 'User account is already linked to another teacher record';
      END IF;
    END IF;
  END IF;

  -- Trim inputs and enforce lower-case trimmed email
  NEW.full_name := trim(COALESCE(NEW.full_name, ''));
  NEW.subject := trim(COALESCE(NEW.subject, ''));
  NEW.email := lower(trim(COALESCE(NEW.email, '')));

  -- Phone sanitization: empty string becomes NULL
  IF NEW.phone IS NOT NULL THEN
    NEW.phone := trim(NEW.phone);
    IF NEW.phone = '' THEN
      NEW.phone := NULL;
    END IF;
  END IF;

  -- Validate required fields
  IF length(NEW.full_name) < 2 THEN
    RAISE EXCEPTION 'Teacher full name is required and must be at least 2 characters.';
  END IF;

  IF length(NEW.subject) < 1 THEN
    RAISE EXCEPTION 'Teacher subject is required.';
  END IF;

  -- Standard RFC-aligned email validation matching client regex
  IF NEW.email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email address format: %', NEW.email;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_teacher_record ON public.teachers;
CREATE TRIGGER tr_validate_teacher_record
BEFORE INSERT OR UPDATE ON public.teachers
FOR EACH ROW
EXECUTE FUNCTION public.validate_teacher_record();

-- C. Parent-student links trigger: coordinate FOR SHARE on parent profile
CREATE OR REPLACE FUNCTION public.validate_parent_student_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent_role public.user_role;
BEGIN
  SELECT role INTO v_parent_role
  FROM public.profiles
  WHERE id = NEW.parent_id
  FOR SHARE;

  IF NOT FOUND OR v_parent_role <> 'parent' THEN
    RAISE EXCEPTION 'parent_student_links.parent_id must reference a valid profile with role parent';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = NEW.student_id) THEN
    RAISE EXCEPTION 'parent_student_links.student_id must reference a valid student';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_parent_student_link ON public.parent_student_links;
CREATE TRIGGER tr_validate_parent_student_link
BEFORE INSERT OR UPDATE ON public.parent_student_links
FOR EACH ROW
EXECUTE FUNCTION public.validate_parent_student_link();

-- D. AFTER UPDATE consistency trigger on public.profiles
--    Executes AFTER table_tuple_update acquires LockTupleNoKeyExclusive on the profile row,
--    guaranteeing visibility of any link transaction that previously held FOR SHARE on this profile.
CREATE OR REPLACE FUNCTION public.enforce_profile_role_link_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NEW.role <> 'teacher' AND EXISTS (SELECT 1 FROM public.teachers WHERE user_id = NEW.id) THEN
      RAISE EXCEPTION 'Cannot change role: user is currently linked to an active teacher record. Unlink account first.';
    END IF;

    IF NEW.role <> 'student' AND EXISTS (SELECT 1 FROM public.students WHERE user_id = NEW.id) THEN
      RAISE EXCEPTION 'Cannot change role: user is currently linked to an active student record. Unlink account first.';
    END IF;

    IF NEW.role <> 'parent' AND EXISTS (SELECT 1 FROM public.parent_student_links WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'Cannot change role: user is currently linked to active parent-student links. Unlink account first.';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_profile_role_link_consistency ON public.profiles;
CREATE TRIGGER tr_enforce_profile_role_link_consistency
AFTER UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_role_link_consistency();

-- 3. Atomic & Race-Safe Administrative RPC Routines

-- A. Atomic Link Teacher Account
CREATE OR REPLACE FUNCTION public.link_teacher_account(
  p_teacher_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role public.user_role;
  v_existing_teacher_user_id UUID;
  v_linked_teacher_id UUID;
  v_linked_user_id UUID;
BEGIN
  IF COALESCE(public.is_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to link accounts';
  END IF;

  IF p_teacher_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Teacher ID and User ID are required';
  END IF;

  -- Lock target profile row FOR SHARE to serialize against concurrent role changes
  SELECT role INTO v_user_role
  FROM public.profiles
  WHERE id = p_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF v_user_role <> 'teacher' THEN
    RAISE EXCEPTION 'Cannot link account: user profile must have role teacher, found %', v_user_role;
  END IF;

  -- Atomic conditional UPDATE: only claims an unlinked teacher row
  BEGIN
    UPDATE public.teachers
    SET user_id = p_user_id
    WHERE id = p_teacher_id
      AND user_id IS NULL
    RETURNING id, user_id INTO v_linked_teacher_id, v_linked_user_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Conflict: User account is already linked to another teacher';
  END;

  -- Verify the modified row matches the requested link before returning success
  IF v_linked_teacher_id IS NOT NULL AND v_linked_user_id = p_user_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'teacher_id', v_linked_teacher_id,
      'user_id', v_linked_user_id
    );
  END IF;

  -- Zero rows updated: distinguish NOT_FOUND vs ALREADY_LINKED conflict
  SELECT user_id INTO v_existing_teacher_user_id
  FROM public.teachers
  WHERE id = p_teacher_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Teacher record not found';
  END IF;

  RAISE EXCEPTION 'Conflict: Teacher is already linked to user account %', v_existing_teacher_user_id;
END;
$$;

-- B. Atomic Unlink Teacher Account
CREATE OR REPLACE FUNCTION public.unlink_teacher_account(
  p_teacher_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_user_id UUID;
  v_updated_id UUID;
  v_after_user_id UUID;
BEGIN
  IF COALESCE(public.is_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to unlink accounts';
  END IF;

  IF p_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Teacher ID is required';
  END IF;

  -- Serialize concurrent unlinks/re-links on this teacher row
  SELECT user_id INTO v_previous_user_id
  FROM public.teachers
  WHERE id = p_teacher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Teacher record not found';
  END IF;

  IF v_previous_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'teacher_id', p_teacher_id,
      'previous_user_id', NULL
    );
  END IF;

  UPDATE public.teachers
  SET user_id = NULL
  WHERE id = p_teacher_id
    AND user_id = v_previous_user_id
  RETURNING id, user_id INTO v_updated_id, v_after_user_id;

  IF v_updated_id IS NULL OR v_after_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Conflict: Teacher link state changed during unlink operation';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'teacher_id', v_updated_id,
    'previous_user_id', v_previous_user_id
  );
END;
$$;

-- C. Atomic Link Student Account
CREATE OR REPLACE FUNCTION public.link_student_account(
  p_student_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role public.user_role;
  v_existing_student_user_id UUID;
  v_linked_student_id UUID;
  v_linked_user_id UUID;
BEGIN
  IF COALESCE(public.is_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to link accounts';
  END IF;

  IF p_student_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Student ID and User ID are required';
  END IF;

  -- Lock target profile row FOR SHARE to serialize against concurrent role changes
  SELECT role INTO v_user_role
  FROM public.profiles
  WHERE id = p_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF v_user_role <> 'student' THEN
    RAISE EXCEPTION 'Cannot link account: user profile must have role student, found %', v_user_role;
  END IF;

  -- Atomic conditional UPDATE: only claims an unlinked student row
  BEGIN
    UPDATE public.students
    SET user_id = p_user_id
    WHERE id = p_student_id
      AND user_id IS NULL
    RETURNING id, user_id INTO v_linked_student_id, v_linked_user_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Conflict: User account is already linked to another student';
  END;

  -- Verify the modified row matches the requested link before returning success
  IF v_linked_student_id IS NOT NULL AND v_linked_user_id = p_user_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'student_id', v_linked_student_id,
      'user_id', v_linked_user_id
    );
  END IF;

  -- Zero rows updated: distinguish NOT_FOUND vs ALREADY_LINKED conflict
  SELECT user_id INTO v_existing_student_user_id
  FROM public.students
  WHERE id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student record not found';
  END IF;

  RAISE EXCEPTION 'Conflict: Student is already linked to user account %', v_existing_student_user_id;
END;
$$;

-- D. Atomic Unlink Student Account
CREATE OR REPLACE FUNCTION public.unlink_student_account(
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_user_id UUID;
  v_updated_id UUID;
  v_after_user_id UUID;
BEGIN
  IF COALESCE(public.is_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to unlink accounts';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Student ID is required';
  END IF;

  -- Serialize concurrent unlinks/re-links on this student row
  SELECT user_id INTO v_previous_user_id
  FROM public.students
  WHERE id = p_student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student record not found';
  END IF;

  IF v_previous_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'student_id', p_student_id,
      'previous_user_id', NULL
    );
  END IF;

  UPDATE public.students
  SET user_id = NULL
  WHERE id = p_student_id
    AND user_id = v_previous_user_id
  RETURNING id, user_id INTO v_updated_id, v_after_user_id;

  IF v_updated_id IS NULL OR v_after_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Conflict: Student link state changed during unlink operation';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_updated_id,
    'previous_user_id', v_previous_user_id
  );
END;
$$;

-- E. Link Parent to Student (with FOR SHARE on parent profile & atomic unique handling)
CREATE OR REPLACE FUNCTION public.link_parent_student(
  p_parent_id UUID,
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_role public.user_role;
  v_link_id UUID;
BEGIN
  IF COALESCE(public.is_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to link accounts';
  END IF;

  IF p_parent_id IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'Parent ID and Student ID are required';
  END IF;

  -- Lock parent profile row FOR SHARE to serialize against concurrent role changes
  SELECT role INTO v_parent_role
  FROM public.profiles
  WHERE id = p_parent_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent profile not found';
  END IF;

  IF v_parent_role <> 'parent' THEN
    RAISE EXCEPTION 'Cannot link account: specified profile must have role parent, found %', v_parent_role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student record not found';
  END IF;

  BEGIN
    INSERT INTO public.parent_student_links (parent_id, student_id, created_by)
    VALUES (p_parent_id, p_student_id, auth.uid())
    RETURNING id INTO v_link_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Link between parent and student already exists';
  END;

  IF v_link_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create parent-student link';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'link_id', v_link_id,
    'parent_id', p_parent_id,
    'student_id', p_student_id
  );
END;
$$;

-- 4. Re-affirm RPC Execute Privileges
REVOKE ALL ON FUNCTION public.link_teacher_account(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_teacher_account(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_student_account(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_student_account(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_parent_student(UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.link_teacher_account(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_teacher_account(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_student_account(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_student_account(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_parent_student(UUID, UUID) TO authenticated;
