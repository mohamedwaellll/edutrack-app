-- =========================================================================
-- EduTrack Stage B.1 Migration (2026-11-21)
-- Secure Account Linking Foundation, Role Elevation Guards & Parent-Student Links
--
-- Migration Order & Precedence:
-- 1. Must run strictly AFTER:
--    20261121000001_edutrack_teacher_management_corrections.sql
-- 2. Must run strictly BEFORE:
--    Future Stage B role-expansion, multi-role portal, and teacher/student access migrations.
--
-- Features Implemented:
-- 1. Pre-execution data integrity checks:
--    - Aborts safely with descriptive error if any duplicate user_id exists in teachers or students.
--    - Aborts if any teachers.user_id points to a profile without role 'teacher'.
--    - Aborts if any students.user_id points to a profile without role 'student'.
--    - Aborts if any teachers or students are linked to non-existent profiles.
-- 2. Schema enhancements & Partial Unique Indexes:
--    - CREATE UNIQUE INDEX idx_teachers_user_id ON public.teachers(user_id) WHERE user_id IS NOT NULL;
--    - CREATE UNIQUE INDEX idx_students_user_id ON public.students(user_id) WHERE user_id IS NOT NULL;
--    - CREATE TABLE public.parent_student_links (parent_id, student_id, created_by, created_at, UNIQUE(parent_id, student_id)).
-- 3. Role Elevation & Anti-Self-Promotion Trigger Hardening:
--    - tr_check_profile_role_insert: non-admins cannot insert profile with role other than 'student'.
--    - tr_check_profile_role: prevents role modifications away from 'teacher', 'student', or 'parent' while an active link exists.
-- 4. Direct Table Mutation Guards:
--    - Teachers: updates to user_id must reference a valid profile with role 'teacher' and not be linked elsewhere.
--    - Students: updates to user_id must reference a valid profile with role 'student' and not be linked elsewhere.
--    - Parent-student links: parent_id must reference a profile with role 'parent'.
-- 5. Trusted Administrative RPC Routines (SECURITY DEFINER, search_path = public):
--    - public.link_teacher_account(p_teacher_id UUID, p_user_id UUID)
--    - public.unlink_teacher_account(p_teacher_id UUID)
--    - public.link_student_account(p_student_id UUID, p_user_id UUID)
--    - public.unlink_student_account(p_student_id UUID)
--    - public.link_parent_student(p_parent_id UUID, p_student_id UUID)
--    - public.unlink_parent_student(p_parent_id UUID, p_student_id UUID)
--    - All verify public.is_admin(), prevent silent overwrite, and return JSONB.
-- 6. Minimal Privileges & Row Level Security:
--    - Enable RLS on public.parent_student_links.
--    - Admins full access policy; parents view own links policy.
--    - Table mutations revoked from authenticated; granted EXECUTE on RPCs to authenticated.
-- =========================================================================

-- 1. Pre-execution Data Integrity Checks (Fail Closed without data loss)
DO $$
DECLARE
  v_dup_teacher_users INT;
  v_orphaned_teacher_users INT;
  v_invalid_teacher_roles INT;
  v_dup_student_users INT;
  v_orphaned_student_users INT;
  v_invalid_student_roles INT;
BEGIN
  -- 1. Check duplicate non-null user_id in teachers
  SELECT count(*) INTO v_dup_teacher_users
  FROM (
    SELECT user_id
    FROM public.teachers
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING count(*) > 1
  ) dups;

  IF v_dup_teacher_users > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration 20261121000002: % duplicate teacher user_id link(s) detected in public.teachers.', v_dup_teacher_users;
  END IF;

  -- 2. Check teachers linked to non-existent profiles
  SELECT count(*) INTO v_orphaned_teacher_users
  FROM public.teachers t
  LEFT JOIN public.profiles p ON t.user_id = p.id
  WHERE t.user_id IS NOT NULL AND p.id IS NULL;

  IF v_orphaned_teacher_users > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration 20261121000002: % teacher(s) linked to non-existent profile(s).', v_orphaned_teacher_users;
  END IF;

  -- 3. Check teachers linked to profiles without role teacher
  SELECT count(*) INTO v_invalid_teacher_roles
  FROM public.teachers t
  JOIN public.profiles p ON t.user_id = p.id
  WHERE t.user_id IS NOT NULL AND p.role <> 'teacher';

  IF v_invalid_teacher_roles > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration 20261121000002: % teacher(s) linked to profile(s) without role teacher.', v_invalid_teacher_roles;
  END IF;

  -- 4. Check duplicate non-null user_id in students
  SELECT count(*) INTO v_dup_student_users
  FROM (
    SELECT user_id
    FROM public.students
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING count(*) > 1
  ) dups;

  IF v_dup_student_users > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration 20261121000002: % duplicate student user_id link(s) detected in public.students.', v_dup_student_users;
  END IF;

  -- 5. Check students linked to non-existent profiles
  SELECT count(*) INTO v_orphaned_student_users
  FROM public.students s
  LEFT JOIN public.profiles p ON s.user_id = p.id
  WHERE s.user_id IS NOT NULL AND p.id IS NULL;

  IF v_orphaned_student_users > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration 20261121000002: % student(s) linked to non-existent profile(s).', v_orphaned_student_users;
  END IF;

  -- 6. Check students linked to profiles without role student
  SELECT count(*) INTO v_invalid_student_roles
  FROM public.students s
  JOIN public.profiles p ON s.user_id = p.id
  WHERE s.user_id IS NOT NULL AND p.role <> 'student';

  IF v_invalid_student_roles > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration 20261121000002: % student(s) linked to profile(s) without role student.', v_invalid_student_roles;
  END IF;
END $$;

-- 2. Partial Unique Indexes for 1:1 Account-Record Linking
CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_user_id
ON public.teachers (user_id)
WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_user_id
ON public.students (user_id)
WHERE user_id IS NOT NULL;

-- 3. Parent-Student Links Table
CREATE TABLE IF NOT EXISTS public.parent_student_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT uq_parent_student_link UNIQUE (parent_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_student_links_parent_id
ON public.parent_student_links (parent_id);

CREATE INDEX IF NOT EXISTS idx_parent_student_links_student_id
ON public.parent_student_links (student_id);

-- 4. Role Elevation & Anti-Self-Promotion Trigger Hardening

-- A. Insert guard: Non-admin users cannot insert profile with any elevated role (must be student)
CREATE OR REPLACE FUNCTION public.check_profile_role_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  is_authorized BOOLEAN := FALSE;
  jwt_claims_text TEXT;
  jwt_role TEXT := '';
BEGIN
  IF COALESCE(NEW.role, 'student') <> 'student' THEN
    -- Check 1: Superuser / maintenance / database owner roles
    IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
      is_authorized := TRUE;
    END IF;

    -- Check 2: Existing admin user
    IF NOT is_authorized AND COALESCE(public.is_admin(), FALSE) = TRUE THEN
      is_authorized := TRUE;
    END IF;

    -- Check 3: Supabase service_role claim check (fail-closed)
    IF NOT is_authorized THEN
      BEGIN
        jwt_claims_text := current_setting('request.jwt.claims', true);
        IF jwt_claims_text IS NOT NULL AND jwt_claims_text <> '' THEN
          jwt_role := COALESCE((jwt_claims_text::jsonb ->> 'role'), '');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        jwt_role := '';
      END;

      IF jwt_role = '' THEN
        BEGIN
          jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
        EXCEPTION WHEN OTHERS THEN
          jwt_role := '';
        END;
      END IF;

      IF jwt_role = 'service_role' THEN
        is_authorized := TRUE;
      END IF;
    END IF;

    -- Fail-closed: Only explicitly true authorization allows elevated role assignment
    IF is_authorized IS NOT TRUE THEN
      RAISE EXCEPTION 'Unauthorized: Only administrators can assign elevated user roles';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_check_profile_role_insert ON public.profiles;
CREATE TRIGGER tr_check_profile_role_insert
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.check_profile_role_insert();

-- B. Update guard: Non-admin cannot modify role; and active link freezes role
CREATE OR REPLACE FUNCTION public.check_profile_role_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  is_authorized BOOLEAN := FALSE;
  jwt_claims_text TEXT;
  jwt_role TEXT := '';
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Active Link Role Freeze: Prevent role changes while account is actively linked
    IF OLD.role = 'teacher' AND NEW.role <> 'teacher' THEN
      IF EXISTS (SELECT 1 FROM public.teachers WHERE user_id = OLD.id) THEN
        RAISE EXCEPTION 'Cannot change role: user is currently linked to an active teacher record. Unlink account first.';
      END IF;
    END IF;

    IF OLD.role = 'student' AND NEW.role <> 'student' THEN
      IF EXISTS (SELECT 1 FROM public.students WHERE user_id = OLD.id) THEN
        RAISE EXCEPTION 'Cannot change role: user is currently linked to an active student record. Unlink account first.';
      END IF;
    END IF;

    IF OLD.role = 'parent' AND NEW.role <> 'parent' THEN
      IF EXISTS (SELECT 1 FROM public.parent_student_links WHERE parent_id = OLD.id) THEN
        RAISE EXCEPTION 'Cannot change role: user is currently linked to active parent-student links. Unlink account first.';
      END IF;
    END IF;

    -- Check 1: Superuser / maintenance / database owner roles
    IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
      is_authorized := TRUE;
    END IF;

    -- Check 2: Existing admin user
    IF NOT is_authorized AND COALESCE(public.is_admin(), FALSE) = TRUE THEN
      is_authorized := TRUE;
    END IF;

    -- Check 3: Supabase service_role claim check (fail-closed)
    IF NOT is_authorized THEN
      BEGIN
        jwt_claims_text := current_setting('request.jwt.claims', true);
        IF jwt_claims_text IS NOT NULL AND jwt_claims_text <> '' THEN
          jwt_role := COALESCE((jwt_claims_text::jsonb ->> 'role'), '');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        jwt_role := '';
      END;

      IF jwt_role = '' THEN
        BEGIN
          jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
        EXCEPTION WHEN OTHERS THEN
          jwt_role := '';
        END;
      END IF;

      IF jwt_role = 'service_role' THEN
        is_authorized := TRUE;
      END IF;
    END IF;

    -- Fail-closed: Only explicitly true authorization allows modification
    IF is_authorized IS NOT TRUE THEN
      RAISE EXCEPTION 'Unauthorized: Only administrators can modify user roles';
    END IF;
  END IF;

  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_check_profile_role ON public.profiles;
CREATE TRIGGER tr_check_profile_role
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.check_profile_role_update();

-- 5. Direct Table Mutation Guards for Teachers, Students, and Links

-- A. Teachers trigger: validate user_id role compatibility on UPDATE
CREATE OR REPLACE FUNCTION public.validate_teacher_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Database enforcement: reject direct user_id assignment on creation
  IF TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Direct user_id assignment is prohibited during teacher creation. Account linking is managed separately.';
  END IF;

  -- User ID link validation on UPDATE
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    IF NEW.user_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id AND role = 'teacher') THEN
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

-- B. Students trigger: validate user_id role compatibility on INSERT or UPDATE
CREATE OR REPLACE FUNCTION public.validate_student_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id AND role = 'student') THEN
      RAISE EXCEPTION 'students.user_id must reference a valid profile with role student';
    END IF;
    IF EXISTS (SELECT 1 FROM public.students WHERE user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'User account is already linked to another student record';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    IF NEW.user_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id AND role = 'student') THEN
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

-- C. Parent-Student links trigger: validate parent role and student existence
CREATE OR REPLACE FUNCTION public.validate_parent_student_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.parent_id AND role = 'parent') THEN
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

-- 6. Trusted Administrative RPC Routines (SECURITY DEFINER, search_path = public)

-- A. Link Teacher Account
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
  v_current_user_id UUID;
  v_user_role public.user_role;
BEGIN
  -- 1. Authorization check
  IF COALESCE(public.is_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to link accounts';
  END IF;

  IF p_teacher_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Teacher ID and User ID are required';
  END IF;

  -- 2. Validate teacher existence and current link state
  SELECT user_id INTO v_current_user_id
  FROM public.teachers
  WHERE id = p_teacher_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Teacher record not found';
  END IF;

  IF v_current_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Teacher is already linked to user account %', v_current_user_id;
  END IF;

  -- 3. Validate user profile existence and role
  SELECT role INTO v_user_role
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF v_user_role <> 'teacher' THEN
    RAISE EXCEPTION 'Cannot link account: user profile must have role teacher, found %', v_user_role;
  END IF;

  -- 4. Check if user is already linked to another teacher
  IF EXISTS (SELECT 1 FROM public.teachers WHERE user_id = p_user_id AND id <> p_teacher_id) THEN
    RAISE EXCEPTION 'User account is already linked to another teacher';
  END IF;

  -- 5. Link
  UPDATE public.teachers
  SET user_id = p_user_id
  WHERE id = p_teacher_id;

  RETURN jsonb_build_object(
    'success', true,
    'teacher_id', p_teacher_id,
    'user_id', p_user_id
  );
END;
$$;

-- B. Unlink Teacher Account
CREATE OR REPLACE FUNCTION public.unlink_teacher_account(
  p_teacher_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_user_id UUID;
BEGIN
  IF COALESCE(public.is_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to unlink accounts';
  END IF;

  IF p_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Teacher ID is required';
  END IF;

  SELECT user_id INTO v_current_user_id
  FROM public.teachers
  WHERE id = p_teacher_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Teacher record not found';
  END IF;

  UPDATE public.teachers
  SET user_id = NULL
  WHERE id = p_teacher_id;

  RETURN jsonb_build_object(
    'success', true,
    'teacher_id', p_teacher_id,
    'previous_user_id', v_current_user_id
  );
END;
$$;

-- C. Link Student Account
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
  v_current_user_id UUID;
  v_user_role public.user_role;
BEGIN
  IF COALESCE(public.is_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to link accounts';
  END IF;

  IF p_student_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Student ID and User ID are required';
  END IF;

  SELECT user_id INTO v_current_user_id
  FROM public.students
  WHERE id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student record not found';
  END IF;

  IF v_current_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Student is already linked to user account %', v_current_user_id;
  END IF;

  SELECT role INTO v_user_role
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF v_user_role <> 'student' THEN
    RAISE EXCEPTION 'Cannot link account: user profile must have role student, found %', v_user_role;
  END IF;

  IF EXISTS (SELECT 1 FROM public.students WHERE user_id = p_user_id AND id <> p_student_id) THEN
    RAISE EXCEPTION 'User account is already linked to another student';
  END IF;

  UPDATE public.students
  SET user_id = p_user_id
  WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'user_id', p_user_id
  );
END;
$$;

-- D. Unlink Student Account
CREATE OR REPLACE FUNCTION public.unlink_student_account(
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_user_id UUID;
BEGIN
  IF COALESCE(public.is_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to unlink accounts';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Student ID is required';
  END IF;

  SELECT user_id INTO v_current_user_id
  FROM public.students
  WHERE id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student record not found';
  END IF;

  UPDATE public.students
  SET user_id = NULL
  WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'previous_user_id', v_current_user_id
  );
END;
$$;

-- E. Link Parent to Student
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

  SELECT role INTO v_parent_role
  FROM public.profiles
  WHERE id = p_parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent profile not found';
  END IF;

  IF v_parent_role <> 'parent' THEN
    RAISE EXCEPTION 'Cannot link account: specified profile must have role parent, found %', v_parent_role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student record not found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.parent_student_links WHERE parent_id = p_parent_id AND student_id = p_student_id) THEN
    RAISE EXCEPTION 'Link between parent and student already exists';
  END IF;

  INSERT INTO public.parent_student_links (parent_id, student_id, created_by)
  VALUES (p_parent_id, p_student_id, auth.uid())
  RETURNING id INTO v_link_id;

  RETURN jsonb_build_object(
    'success', true,
    'link_id', v_link_id,
    'parent_id', p_parent_id,
    'student_id', p_student_id
  );
END;
$$;

-- F. Unlink Parent from Student
CREATE OR REPLACE FUNCTION public.unlink_parent_student(
  p_parent_id UUID,
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(public.is_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to unlink accounts';
  END IF;

  IF p_parent_id IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'Parent ID and Student ID are required';
  END IF;

  DELETE FROM public.parent_student_links
  WHERE parent_id = p_parent_id AND student_id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent-student link not found';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'parent_id', p_parent_id,
    'student_id', p_student_id
  );
END;
$$;

-- 7. Permissions and Grants Hardening

-- A. Revoke RPC execution from PUBLIC and anon; grant strictly to authenticated
REVOKE ALL ON FUNCTION public.link_teacher_account(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_teacher_account(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_student_account(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_student_account(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_parent_student(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_parent_student(UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.link_teacher_account(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_teacher_account(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_student_account(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_student_account(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_parent_student(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_parent_student(UUID, UUID) TO authenticated;

-- B. Table Privileges on profiles (enabling RLS and role triggers)
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
REVOKE DELETE, TRUNCATE ON public.profiles FROM authenticated;
REVOKE ALL ON public.profiles FROM anon, PUBLIC;

-- C. Table Privileges on parent_student_links
GRANT SELECT ON public.parent_student_links TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.parent_student_links FROM authenticated;
REVOKE ALL ON public.parent_student_links FROM anon, PUBLIC;

-- D. Row Level Security on parent_student_links
ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to parent_student_links" ON public.parent_student_links;
CREATE POLICY "Admins have full access to parent_student_links"
ON public.parent_student_links FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Parents can view their own student links" ON public.parent_student_links;
CREATE POLICY "Parents can view their own student links"
ON public.parent_student_links FOR SELECT
TO authenticated
USING (parent_id = auth.uid());
