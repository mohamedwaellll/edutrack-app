-- =========================================================================
-- EduTrack Corrective Security Migration (2026-11-18)
-- Patch: Fail-Closed Profile Role Authorization & PostgREST Claims Handling
--
-- Fixes:
-- 1. Eliminates SQL 3VL (Three-Valued Logic) NULL vulnerability in role checks
-- 2. Evaluates explicit boolean authorization with fail-closed default (FALSE)
-- 3. Supports modern PostgREST JSON claims ('request.jwt.claims') as well as
--    legacy setting ('request.jwt.claim.role') without crashing or failing open
-- 4. Ensures authenticated/anon clients cannot self-promote via INSERT, UPDATE,
--    UPSERT, or function execution
-- =========================================================================

-- Step 1: Ensure is_admin() helper is STABLE and SECURITY DEFINER
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

-- Step 2: Fail-closed role update trigger
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

-- Step 3: Fail-closed role insert trigger
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

-- Step 4: Maintenance-only provision_admin function
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

-- Explicitly revoke execute from PUBLIC, anon, and authenticated
REVOKE EXECUTE ON FUNCTION public.provision_admin(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_admin(UUID, TEXT, TEXT) TO postgres, service_role;
