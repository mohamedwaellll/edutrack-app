-- =========================================================================
-- EduTrack Migration Upgrade Patch (2026-11-17)
-- Non-destructive upgrade for existing deployments
-- 1. Replaces permissive USING (true) policies with database-enforced is_admin() RLS
-- 2. Adds security functions (is_admin, prevent self role elevation)
-- 3. Adds enrolled_count automatic synchronization trigger
-- =========================================================================

-- Step 1: Ensure extensions exist safely
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Built-in uuid_generate_v4 fallback to gen_random_uuid() for maximum portability
CREATE OR REPLACE FUNCTION public.uuid_generate_v4()
RETURNS UUID AS $$
  SELECT gen_random_uuid();
$$ LANGUAGE sql;

-- Step 2: Ensure is_admin() helper exists (SECURITY DEFINER avoids recursive RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Step 3: Triggers to prevent self-elevation to admin by non-admin users (Fail-Closed)
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

-- Prevent unauthorized role assignment on profile INSERT (Fail-Closed)
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
  IF NEW.role = 'admin' THEN
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

    -- Fail-closed: Only explicitly true authorization allows admin assignment
    IF is_authorized IS NOT TRUE THEN
      RAISE EXCEPTION 'Unauthorized: Only administrators can assign the admin role';
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

-- Stored procedure for secure initial admin provisioning
-- Handles BOTH cases:
-- Case 1: Auth user without a profile record -> INSERT
-- Case 2: Auth user with an existing non-admin profile record -> UPDATE to 'admin'
CREATE OR REPLACE FUNCTION public.provision_admin(
  target_user_id UUID,
  target_email TEXT DEFAULT NULL,
  target_full_name TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_authorized BOOLEAN := FALSE;
  jwt_claims_text TEXT;
  jwt_role TEXT := '';
  resolved_email TEXT;
  resolved_name TEXT;
  result_profile public.profiles;
BEGIN
  -- Check 1: Direct database maintenance roles
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    is_authorized := TRUE;
  END IF;

  -- Check 2: service_role JWT
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

  -- Fail-closed enforcement:
  IF is_authorized IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Only database administrators can provision admin privileges';
  END IF;

  BEGIN
    SELECT email INTO resolved_email FROM auth.users WHERE id = target_user_id;
  EXCEPTION WHEN OTHERS THEN
    resolved_email := NULL;
  END;

  resolved_email := COALESCE(target_email, resolved_email, 'admin@edutrack.com');
  resolved_name := COALESCE(target_full_name, 'System Administrator');

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (target_user_id, resolved_email, resolved_name, 'admin')
  ON CONFLICT (id) DO UPDATE SET
    role = 'admin',
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    updated_at = NOW()
  RETURNING * INTO result_profile;

  RETURN result_profile;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_admin(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_admin(UUID, TEXT, TEXT) TO postgres, service_role;

-- Step 4: Enrolled count synchronization trigger
CREATE OR REPLACE FUNCTION public.sync_group_enrolled_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.group_id IS NOT NULL THEN
    UPDATE public.groups
    SET enrolled_count = (SELECT COUNT(*) FROM public.students WHERE group_id = NEW.group_id)
    WHERE id = NEW.group_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.group_id IS DISTINCT FROM NEW.group_id THEN
      IF OLD.group_id IS NOT NULL THEN
        UPDATE public.groups
        SET enrolled_count = (SELECT COUNT(*) FROM public.students WHERE group_id = OLD.group_id)
        WHERE id = OLD.group_id;
      END IF;
      IF NEW.group_id IS NOT NULL THEN
        UPDATE public.groups
        SET enrolled_count = (SELECT COUNT(*) FROM public.students WHERE group_id = NEW.group_id)
        WHERE id = NEW.group_id;
      END IF;
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.group_id IS NOT NULL THEN
    UPDATE public.groups
    SET enrolled_count = (SELECT COUNT(*) FROM public.students WHERE group_id = OLD.group_id)
    WHERE id = OLD.group_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_group_enrolled_count ON public.students;
CREATE TRIGGER tr_sync_group_enrolled_count
AFTER INSERT OR UPDATE OR DELETE ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.sync_group_enrolled_count();

-- Recalculate existing group enrolled counts non-destructively
UPDATE public.groups g
SET enrolled_count = (
  SELECT COUNT(*) FROM public.students s WHERE s.group_id = g.id
);

-- Step 5: Replace permissive USING (true) policies with secure RLS policies

-- Drop legacy permissive policies
DROP POLICY IF EXISTS "Admins have full access" ON public.profiles;
DROP POLICY IF EXISTS "Admins have full access" ON public.groups;
DROP POLICY IF EXISTS "Admins have full access" ON public.teachers;
DROP POLICY IF EXISTS "Admins have full access" ON public.students;
DROP POLICY IF EXISTS "Admins have full access" ON public.attendance;
DROP POLICY IF EXISTS "Admins have full access" ON public.grades;
DROP POLICY IF EXISTS "Admins have full access" ON public.teacher_notes;
DROP POLICY IF EXISTS "Admins have full access" ON public.activity_logs;

-- Profiles: Self read/update, admin all
DROP POLICY IF EXISTS "Users can view own profile or admin views all" ON public.profiles;
CREATE POLICY "Users can view own profile or admin views all"
ON public.profiles FOR SELECT
TO authenticated
USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (id = auth.uid() OR public.is_admin())
WITH CHECK (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid() AND (role <> 'admin' OR public.is_admin()));

-- Groups: Admins full access
DROP POLICY IF EXISTS "Admins have full access to groups" ON public.groups;
CREATE POLICY "Admins have full access to groups"
ON public.groups FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Students: Admins full access
DROP POLICY IF EXISTS "Admins have full access to students" ON public.students;
CREATE POLICY "Admins have full access to students"
ON public.students FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Teachers: Admins full access
DROP POLICY IF EXISTS "Admins have full access to teachers" ON public.teachers;
CREATE POLICY "Admins have full access to teachers"
ON public.teachers FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Attendance: Admins full access
DROP POLICY IF EXISTS "Admins have full access to attendance" ON public.attendance;
CREATE POLICY "Admins have full access to attendance"
ON public.attendance FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Grades: Admins full access
DROP POLICY IF EXISTS "Admins have full access to grades" ON public.grades;
CREATE POLICY "Admins have full access to grades"
ON public.grades FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Teacher notes: Admins full access
DROP POLICY IF EXISTS "Admins have full access to teacher_notes" ON public.teacher_notes;
CREATE POLICY "Admins have full access to teacher_notes"
ON public.teacher_notes FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Activity logs: Admins full access
DROP POLICY IF EXISTS "Admins have full access to activity_logs" ON public.activity_logs;
CREATE POLICY "Admins have full access to activity_logs"
ON public.activity_logs FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
