-- =========================================================================
-- EduTrack Migration Upgrade Patch (2026-11-17)
-- Non-destructive upgrade for existing deployments
-- 1. Replaces permissive USING (true) policies with database-enforced is_admin() RLS
-- 2. Adds security functions (is_admin, prevent self role elevation)
-- 3. Adds enrolled_count automatic synchronization trigger
-- =========================================================================

-- Step 1: Ensure extensions exist
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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

-- Step 3: Trigger to prevent self-elevation to admin by non-admin users
CREATE OR REPLACE FUNCTION public.check_profile_role_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT public.is_admin() THEN
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
