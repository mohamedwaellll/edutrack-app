-- =========================================================================
-- EduTrack Milestone 3 Migration (2026-11-20)
-- Real QR Attendance Atomic RPC & Africa/Cairo Time Fixes
--
-- Fixes:
-- 1. Updates validate_attendance_record() to use Africa/Cairo timezone:
--    - Replaces naive CURRENT_TIME with (NOW() AT TIME ZONE 'Africa/Cairo')::TIME
--    - Preserves original arrival time when correcting Present <-> Late on UPDATE
--    - Does not fabricate an arrival time for backdated manual attendance (date < today)
--    - Preserves scan_method rather than globally overwriting it
-- 2. Creates atomic record_qr_attendance(p_qr_hash, p_group_id) RPC:
--    - Requires public.is_admin() (fails closed for non-admins)
--    - Resolves and validates student by qr_code_hash
--    - Enforces active status and group membership
--    - Server-side Africa/Cairo date and time
--    - Returns "Already recorded" on duplicate scan without overwriting
--    - Flags conflict if student was previously marked Absent/Excused
--    - Derives scanned_by from auth.uid()
-- 3. Grants execute on record_qr_attendance to authenticated only.
-- =========================================================================

-- Step 1: Improved trigger function with explicit Africa/Cairo time handling
CREATE OR REPLACE FUNCTION public.validate_attendance_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_actual_group UUID;
  cairo_today DATE;
  cairo_now_time TIME;
BEGIN
  cairo_today := (NOW() AT TIME ZONE 'Africa/Cairo')::DATE;
  cairo_now_time := (NOW() AT TIME ZONE 'Africa/Cairo')::TIME;

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

  -- 3. Handle check_in_time according to status
  IF NEW.status IN ('Absent', 'Excused') THEN
    -- Absent / Excused records must NEVER contain a fabricated check-in time
    NEW.check_in_time := NULL;
  ELSIF NEW.status IN ('Present', 'Late') THEN
    -- Preserve existing arrival time when correcting between Present <-> Late on UPDATE
    IF TG_OP = 'UPDATE' AND OLD.check_in_time IS NOT NULL AND NEW.check_in_time IS NULL THEN
      NEW.check_in_time := OLD.check_in_time;
    ELSIF NEW.check_in_time IS NULL THEN
      -- Only set current Cairo time if the attendance is for today or future;
      -- Do NOT fabricate arrival time for backdated manual attendance
      IF NEW.date >= cairo_today THEN
        NEW.check_in_time := cairo_now_time;
      END IF;
    END IF;
  END IF;

  -- 4. Derive/validate the recording user's identity using authenticated session
  IF auth.uid() IS NOT NULL THEN
    NEW.scanned_by := auth.uid();
  END IF;

  -- 5. Preserve scan_method on update or default to 'manual' on insert
  IF TG_OP = 'UPDATE' AND (NEW.scan_method IS NULL OR NEW.scan_method = '') THEN
    NEW.scan_method := OLD.scan_method;
  ELSIF NEW.scan_method IS NULL OR NEW.scan_method = '' THEN
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

-- Step 2: Atomic QR Attendance RPC
CREATE OR REPLACE FUNCTION public.record_qr_attendance(
  p_qr_hash TEXT,
  p_group_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_today DATE;
  v_now_time TIME;
  v_existing RECORD;
  v_result RECORD;
BEGIN
  -- 1. Authorization: Only authenticated administrators can execute QR attendance
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators can record QR attendance';
  END IF;

  IF p_qr_hash IS NULL OR trim(p_qr_hash) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'EMPTY_TOKEN',
      'message', 'QR code token cannot be empty'
    );
  END IF;

  -- 2. Server-side date and time in Africa/Cairo
  v_today := (NOW() AT TIME ZONE 'Africa/Cairo')::DATE;
  v_now_time := (NOW() AT TIME ZONE 'Africa/Cairo')::TIME;

  -- 3. Validate student token and fetch student details
  SELECT id, full_name, student_code, group_id, status
  INTO v_student
  FROM public.students
  WHERE qr_code_hash = trim(p_qr_hash);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_TOKEN',
      'message', 'No student found matching this QR code'
    );
  END IF;

  -- 4. Check active status
  IF v_student.status <> 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INACTIVE_STUDENT',
      'message', format('Student "%s" is not active (status: %s)', v_student.full_name, v_student.status)
    );
  END IF;

  -- 5. Validate selected group matches student's assigned group
  IF p_group_id IS NOT NULL AND v_student.group_id <> p_group_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'GROUP_MISMATCH',
      'message', format('Student "%s" belongs to a different class group', v_student.full_name)
    );
  END IF;

  -- 6. Check existing record for today (UNIQUE(student_id, date))
  SELECT id, student_id, group_id, status, check_in_time, scan_method, scanned_by
  INTO v_existing
  FROM public.attendance
  WHERE student_id = v_student.id AND date = v_today;

  IF FOUND THEN
    -- If existing status is Present or Late: return "Already recorded" and preserve original values
    IF v_existing.status IN ('Present', 'Late') THEN
      RETURN jsonb_build_object(
        'success', true,
        'code', 'ALREADY_RECORDED',
        'message', format('Already recorded today for %s at %s (%s)', v_student.full_name, substring(v_existing.check_in_time::text from 1 for 5), v_existing.status),
        'attendance', jsonb_build_object(
          'id', v_existing.id,
          'student_id', v_existing.student_id,
          'student_name', v_student.full_name,
          'student_code', v_student.student_code,
          'group_id', v_existing.group_id,
          'status', v_existing.status,
          'check_in_time', substring(v_existing.check_in_time::text from 1 for 5),
          'date', v_today,
          'method', v_existing.scan_method
        )
      );
    ELSE
      -- Existing status is Absent or Excused:
      -- Show clear conflict and direct admin to manual correction
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CONFLICT_EXISTS',
        'message', format('Student %s was previously marked as "%s" today. Please use manual attendance to adjust this status.', v_student.full_name, v_existing.status)
      );
    END IF;
  END IF;

  -- 7. Insert new record atomically
  -- Initial QR scan is marked as 'Present' with scan_method = 'qr'
  INSERT INTO public.attendance (
    student_id,
    group_id,
    date,
    status,
    check_in_time,
    scan_method,
    scanned_by
  )
  VALUES (
    v_student.id,
    v_student.group_id,
    v_today,
    'Present',
    v_now_time,
    'qr',
    auth.uid()
  )
  RETURNING id, student_id, group_id, date, status, check_in_time, scan_method
  INTO v_result;

  -- Log activity (best effort)
  BEGIN
    INSERT INTO public.activity_logs (title, description, type)
    VALUES (
      'QR Check-In',
      format('%s checked in via QR scanner (%s)', v_student.full_name, v_student.student_code),
      'schedule'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'RECORDED',
    'message', format('Check-in confirmed for %s at %s', v_student.full_name, substring(v_result.check_in_time::text from 1 for 5)),
    'attendance', jsonb_build_object(
      'id', v_result.id,
      'student_id', v_result.student_id,
      'student_name', v_student.full_name,
      'student_code', v_student.student_code,
      'group_id', v_result.group_id,
      'status', v_result.status,
      'check_in_time', substring(v_result.check_in_time::text from 1 for 5),
      'date', v_today,
      'method', 'qr'
    )
  );
END;
$$;

-- Step 3: Grant permissions on record_qr_attendance
GRANT EXECUTE ON FUNCTION public.record_qr_attendance(TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_qr_attendance(TEXT, UUID) FROM anon;
