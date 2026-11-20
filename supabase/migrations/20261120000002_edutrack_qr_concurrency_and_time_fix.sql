-- =========================================================================
-- EduTrack Milestone 3 Corrective Migration (2026-11-20)
-- Concurrency-Safe QR Scans, Group Validation & Strict Arrival Time Rules
--
-- Applies on top of 20261120000001_edutrack_qr_attendance_and_cairo_time.sql
--
-- Fixes:
-- 1. Database defaults:
--    - Sets public.attendance.date DEFAULT to ((NOW() AT TIME ZONE 'Africa/Cairo')::DATE)
-- 2. Concurrency-safe record_qr_attendance():
--    - Requires non-null p_group_id
--    - Rejects students without an assigned group (group_id IS NULL)
--    - Rejects students belonging to a different group
--    - Verifies existing attendance belongs to selected group before ALREADY_RECORDED
--    - Flags historical attendance under another group as explicit conflict
--    - Uses INSERT ... ON CONFLICT (student_id, date) DO NOTHING to prevent
--      unhandled unique_violation exceptions during concurrent scans
--    - Resolves collisions safely: returns 1 RECORDED and subsequent ALREADY_RECORDED
--    - Flags competing manual attendance (Absent/Excused) as CONFLICT_EXISTS
-- 3. Strict arrival time rules in validate_attendance_record():
--    - Present <-> Late corrections strictly retain original check_in_time
--    - Backdated manual records (date < today) NEVER receive current time
--    - Future manual records (date > today) NEVER receive current time
--    - Absent and Excused records strictly receive NULL check_in_time
-- 4. Explicit function privileges:
--    - Revokes EXECUTE from PUBLIC and anon
--    - Grants EXECUTE only to authenticated
-- =========================================================================

-- 1. Set database date default to Africa/Cairo date
ALTER TABLE public.attendance 
  ALTER COLUMN date SET DEFAULT ((NOW() AT TIME ZONE 'Africa/Cairo')::DATE);

-- 2. Enhanced Trigger: Strict Africa/Cairo time handling and time preservation
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

  -- Verify student exists and fetch assigned group
  SELECT group_id INTO student_actual_group
  FROM public.students
  WHERE id = NEW.student_id;

  IF student_actual_group IS NULL THEN
    RAISE EXCEPTION 'Student does not exist or has no assigned group';
  END IF;

  -- Reject mismatch between provided group_id and student's actual group
  IF NEW.group_id IS NOT NULL AND NEW.group_id <> student_actual_group THEN
    RAISE EXCEPTION 'Student does not belong to the specified group';
  END IF;

  -- Auto-populate group_id from student if missing
  IF NEW.group_id IS NULL THEN
    NEW.group_id := student_actual_group;
  END IF;

  -- Handle check_in_time according to status & date
  IF NEW.status IN ('Absent', 'Excused') THEN
    -- Absent / Excused records must NEVER contain a check-in time
    NEW.check_in_time := NULL;
  ELSIF NEW.status IN ('Present', 'Late') THEN
    IF TG_OP = 'UPDATE' THEN
      -- Present <-> Late corrections strictly retain the original arrival time
      IF OLD.check_in_time IS NOT NULL AND OLD.status IN ('Present', 'Late') THEN
        NEW.check_in_time := OLD.check_in_time;
      ELSIF NEW.check_in_time IS NULL AND OLD.check_in_time IS NOT NULL THEN
        NEW.check_in_time := OLD.check_in_time;
      ELSIF NEW.check_in_time IS NULL THEN
        -- Only set current Cairo time if explicitly for today
        IF NEW.date = cairo_today THEN
          NEW.check_in_time := cairo_now_time;
        ELSE
          NEW.check_in_time := NULL;
        END IF;
      ELSIF NEW.date <> cairo_today AND NEW.check_in_time = cairo_now_time THEN
        -- Strip fabricated current time for past or future dates
        NEW.check_in_time := NULL;
      END IF;
    ELSE
      -- INSERT path
      IF NEW.check_in_time IS NULL THEN
        -- Only assign current Cairo time for today's records
        IF NEW.date = cairo_today THEN
          NEW.check_in_time := cairo_now_time;
        ELSE
          NEW.check_in_time := NULL;
        END IF;
      ELSIF NEW.date <> cairo_today AND NEW.check_in_time = cairo_now_time THEN
        -- Strip fabricated current time for past or future dates
        NEW.check_in_time := NULL;
      END IF;
    END IF;
  END IF;

  -- Derive recording user identity
  IF auth.uid() IS NOT NULL THEN
    NEW.scanned_by := auth.uid();
  END IF;

  -- Preserve scan_method on update or default to 'manual' on insert
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

-- 3. Concurrency-Safe QR Attendance RPC
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

  -- 2. Validate input parameters
  IF p_group_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'GROUP_REQUIRED',
      'message', 'A target class group is required before scanning'
    );
  END IF;

  IF p_qr_hash IS NULL OR trim(p_qr_hash) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'EMPTY_TOKEN',
      'message', 'QR code token cannot be empty'
    );
  END IF;

  -- 3. Server-side date and time in Africa/Cairo
  v_today := (NOW() AT TIME ZONE 'Africa/Cairo')::DATE;
  v_now_time := (NOW() AT TIME ZONE 'Africa/Cairo')::TIME;

  -- 4. Validate student token and fetch student details
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

  -- 5. Reject student without an assigned group
  IF v_student.group_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'STUDENT_UNASSIGNED',
      'message', format('Student "%s" is not assigned to any class group', v_student.full_name)
    );
  END IF;

  -- 6. Check active status
  IF v_student.status <> 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INACTIVE_STUDENT',
      'message', format('Student "%s" is not active (status: %s)', v_student.full_name, v_student.status)
    );
  END IF;

  -- 7. Validate selected group matches student's assigned group
  IF v_student.group_id <> p_group_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'GROUP_MISMATCH',
      'message', format('Student "%s" belongs to a different class group', v_student.full_name)
    );
  END IF;

  -- 8. Check existing record for today (pre-check for fast classification)
  SELECT id, student_id, group_id, status, check_in_time, scan_method, scanned_by
  INTO v_existing
  FROM public.attendance
  WHERE student_id = v_student.id AND date = v_today;

  IF FOUND THEN
    -- Verify historical attendance group matches selected group
    IF v_existing.group_id <> p_group_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'HISTORICAL_GROUP_MISMATCH',
        'message', format('Conflict: Student %s already has attendance on %s recorded under a different group', v_student.full_name, v_today)
      );
    END IF;

    -- If existing status is Present or Late: return ALREADY_RECORDED and preserve original values
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
      -- Competing manual attendance marked Absent or Excused:
      -- Explicit conflict; do not overwrite arrival time or status
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CONFLICT_EXISTS',
        'message', format('Student %s was previously marked as "%s" today. Please use manual attendance to adjust this status.', v_student.full_name, v_existing.status)
      );
    END IF;
  END IF;

  -- 9. Concurrency-Safe Insert:
  -- Uses ON CONFLICT (student_id, date) DO NOTHING to safely handle competing concurrent scans
  -- without raising an unhandled unique_violation exception.
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
  ON CONFLICT (student_id, date) DO NOTHING
  RETURNING id, student_id, group_id, date, status, check_in_time, scan_method
  INTO v_result;

  -- 10. Check if this call won the insert race
  IF v_result.id IS NOT NULL THEN
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
  END IF;

  -- 11. If DO NOTHING fired, a concurrent request inserted the row a split-second earlier.
  -- Re-read the saved record to classify the result without modifying anything.
  SELECT id, student_id, group_id, status, check_in_time, scan_method, scanned_by
  INTO v_existing
  FROM public.attendance
  WHERE student_id = v_student.id AND date = v_today;

  IF FOUND THEN
    IF v_existing.group_id <> p_group_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'HISTORICAL_GROUP_MISMATCH',
        'message', format('Conflict: Student %s already has attendance on %s recorded under a different group', v_student.full_name, v_today)
      );
    END IF;

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
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CONFLICT_EXISTS',
        'message', format('Student %s was previously marked as "%s" today. Please use manual attendance to adjust this status.', v_student.full_name, v_existing.status)
      );
    END IF;
  END IF;

  -- Fallback unexpected state
  RETURN jsonb_build_object(
    'success', false,
    'code', 'ERROR',
    'message', 'Unable to resolve attendance state for student'
  );
END;
$$;

-- 4. Explicit Function Privileges:
-- Revoke all permissions from PUBLIC and anon, grant execute strictly to authenticated
REVOKE ALL ON FUNCTION public.record_qr_attendance(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_qr_attendance(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_qr_attendance(TEXT, UUID) TO authenticated;
