-- =========================================================================
-- EduTrack Milestone 2 Migration (2026-11-19)
-- Manual Attendance Persistence, Integrity Trigger & API Table Grants
--
-- Fixes:
-- 1. Drops NOT NULL and DEFAULT on attendance.check_in_time so Absent/Excused
--    records do not contain a fabricated check-in time.
-- 2. Adds validate_attendance_record trigger:
--    - Enforces that student belongs to the selected group
--    - Ensures Absent/Excused records have NULL check_in_time
--    - Derives/overrides scanned_by from auth.uid() (cannot be forged)
--    - Sets scan_method to 'manual' if not provided
-- 3. Grants required permissions to authenticated role for manual attendance
--    (SELECT, INSERT, UPDATE on public.attendance) while preserving admin RLS.
-- =========================================================================

-- Step 1: Ensure columns exist and adjust check_in_time nullability and default
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS check_in_time TIME;
ALTER TABLE public.attendance ALTER COLUMN check_in_time DROP NOT NULL;
ALTER TABLE public.attendance ALTER COLUMN check_in_time DROP DEFAULT;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS scan_method TEXT DEFAULT 'manual';
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS scanned_by UUID;

DO $$ BEGIN
  ALTER TABLE public.attendance ADD CONSTRAINT unique_daily_attendance UNIQUE(student_id, date);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

-- Step 2: Trigger for attendance validation and integrity
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

  -- 2. Reject mismatch between provided group_id and student's actual group
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
  -- Overwrite any client-supplied scanned_by with real auth.uid()
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

-- Step 3: Reproducible API permissions for authenticated role
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Baseline application permissions
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT, INSERT ON public.groups TO authenticated;
GRANT SELECT, INSERT ON public.students TO authenticated;
GRANT SELECT ON public.teachers TO authenticated;
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;

-- Milestone 2 attendance permissions (SELECT, INSERT, UPDATE)
GRANT SELECT, INSERT, UPDATE ON public.attendance TO authenticated;

-- Execution permissions: ONLY is_admin() for authenticated
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.provision_admin FROM anon, authenticated;
