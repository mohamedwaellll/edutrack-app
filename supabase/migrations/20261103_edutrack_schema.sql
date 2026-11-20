-- =========================================================================
-- EduTrack Database Schema (PostgreSQL / Supabase)
-- Module: Required Schema Setup & Database-Enforced Authorization (RLS)
-- Note: Seed data is strictly separated into 20261103_edutrack_seed.sql
-- =========================================================================

-- Enable UUID extensions safely if available in environment
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

-- 1. ENUMS
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'student', 'parent');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE attendance_status AS ENUM ('Present', 'Late', 'Absent', 'Excused');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE grade_category AS ENUM ('exam', 'quiz', 'assignment', 'participation');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. USERS / PROFILES (Links to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'student',
    phone TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TEACHERS TABLE
CREATE TABLE IF NOT EXISTS public.teachers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    room_number TEXT,
    hire_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. GROUPS / CLASSES TABLE
CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL, -- e.g. "Grade 8A", "Grade 7B"
    grade_level TEXT NOT NULL, -- e.g. "Grade 8"
    teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
    subject TEXT, -- e.g. "Science", "Mathematics"
    room TEXT DEFAULT 'Room 204',
    capacity INT DEFAULT 30,
    enrolled_count INT DEFAULT 0,
    schedule TEXT DEFAULT 'Sun - Thu: 08:00 AM - 02:00 PM',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. STUDENTS TABLE
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    student_code TEXT UNIQUE NOT NULL, -- e.g. "ET-2048"
    group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
    grade_level TEXT NOT NULL,
    qr_code_hash TEXT UNIQUE NOT NULL,
    parent_name TEXT,
    parent_phone TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'graduated')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ATTENDANCE TABLE
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
    status attendance_status NOT NULL DEFAULT 'Present',
    check_in_time TIME,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    scan_method TEXT DEFAULT 'manual' CHECK (scan_method IN ('qr', 'manual')),
    scanned_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_daily_attendance UNIQUE(student_id, date)
);

-- 7. GRADES TABLE
CREATE TABLE IF NOT EXISTS public.grades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
    assessment_title TEXT NOT NULL,
    grade_type grade_category NOT NULL DEFAULT 'exam',
    score NUMERIC(5,2) NOT NULL,
    max_score NUMERIC(5,2) NOT NULL DEFAULT 100,
    assessment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. TEACHER NOTES TABLE
CREATE TABLE IF NOT EXISTS public.teacher_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    feedback_text TEXT NOT NULL,
    is_parent_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. ACTIVITY LOGS TABLE
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL, -- 'student' | 'schedule' | 'report' | 'teacher'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- DATABASE FUNCTIONS & TRIGGERS (Security & Automation)
-- =========================================================================

-- Helper to check if current authenticated user has the 'admin' role
-- SECURITY DEFINER runs with creator privileges and avoids recursive RLS evaluation
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

-- Trigger to prevent self-elevation to admin by non-admin users (Fail-Closed)
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

-- Auto-update group enrolled_count when students are added or changed
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

-- =========================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 1. PROFILES POLICIES
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

-- 2. GROUPS POLICIES (Admins only for this milestone)
DROP POLICY IF EXISTS "Admins have full access to groups" ON public.groups;
CREATE POLICY "Admins have full access to groups"
ON public.groups FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 3. STUDENTS POLICIES (Admins only for this milestone)
DROP POLICY IF EXISTS "Admins have full access to students" ON public.students;
CREATE POLICY "Admins have full access to students"
ON public.students FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 4. TEACHERS POLICIES (Admins only for this milestone)
DROP POLICY IF EXISTS "Admins have full access to teachers" ON public.teachers;
CREATE POLICY "Admins have full access to teachers"
ON public.teachers FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 5. ATTENDANCE POLICIES (Admins only for this milestone)
DROP POLICY IF EXISTS "Admins have full access to attendance" ON public.attendance;
CREATE POLICY "Admins have full access to attendance"
ON public.attendance FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 6. GRADES POLICIES (Admins only for this milestone)
DROP POLICY IF EXISTS "Admins have full access to grades" ON public.grades;
CREATE POLICY "Admins have full access to grades"
ON public.grades FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 7. TEACHER NOTES POLICIES (Admins only for this milestone)
DROP POLICY IF EXISTS "Admins have full access to teacher_notes" ON public.teacher_notes;
CREATE POLICY "Admins have full access to teacher_notes"
ON public.teacher_notes FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 8. ACTIVITY LOGS POLICIES (Admins only for this milestone)
DROP POLICY IF EXISTS "Admins have full access to activity_logs" ON public.activity_logs;
CREATE POLICY "Admins have full access to activity_logs"
ON public.activity_logs FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Trigger for attendance validation and integrity
CREATE OR REPLACE FUNCTION public.validate_attendance_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_actual_group UUID;
BEGIN
  -- 1. Verify student exists and fetch assigned group
  SELECT group_id INTO student_actual_group
  FROM public.students
  WHERE id = NEW.student_id;

  IF student_actual_group IS NULL THEN
    RAISE EXCEPTION 'Student does not exist or has no assigned group';
  END IF;

  -- 2. Reject mismatch between provided group_id and student actual group
  IF NEW.group_id IS NOT NULL AND NEW.group_id <> student_actual_group THEN
    RAISE EXCEPTION 'Student does not belong to the specified group';
  END IF;

  -- Auto-populate group_id from student if missing
  IF NEW.group_id IS NULL THEN
    NEW.group_id := student_actual_group;
  END IF;

  -- 3. Absent / Excused records must not contain a fabricated check-in time
  IF NEW.status IN ('Absent', 'Excused') THEN
    NEW.check_in_time := NULL;
  ELSIF NEW.status IN ('Present', 'Late') AND NEW.check_in_time IS NULL THEN
    NEW.check_in_time := CURRENT_TIME;
  END IF;

  -- 4. Derive/validate the recording user's identity using authenticated session
  IF auth.uid() IS NOT NULL THEN
    NEW.scanned_by := auth.uid();
  END IF;

  -- 5. Default scan_method to 'manual'
  IF NEW.scan_method IS NULL OR NEW.scan_method = '' THEN
    NEW.scan_method := 'manual';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_attendance_record ON public.attendance;
CREATE TRIGGER tr_validate_attendance_record
BEFORE INSERT OR UPDATE ON public.attendance
FOR EACH ROW
EXECUTE FUNCTION public.validate_attendance_record();

-- API Table & Routine Grants for authenticated and anon roles
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT, INSERT ON public.groups TO authenticated;
GRANT SELECT, INSERT ON public.students TO authenticated;
GRANT SELECT, INSERT ON public.teachers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attendance TO authenticated;
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.provision_admin FROM anon, authenticated;
