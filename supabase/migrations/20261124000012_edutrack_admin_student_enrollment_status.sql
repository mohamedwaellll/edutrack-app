-- =========================================================================
-- EduTrack Admin Student Enrollment Status Migration (2026-11-24)
--
-- Narrow authenticated-admin RPC to update a student's enrollment status
-- (active / suspended / graduated) without deleting records, modifying
-- auth.users, or altering historical attendance, grades, or links.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.update_student_enrollment_status(
  p_student_id UUID,
  p_new_status TEXT,
  p_expected_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_new_status TEXT;
  v_expected_status TEXT;
  v_student RECORD;
  v_updated_id UUID;
  v_updated_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(public.is_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to update student enrollment status.' USING ERRCODE = '42501';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Student ID is required.' USING ERRCODE = '22023';
  END IF;

  v_new_status := LOWER(TRIM(COALESCE(p_new_status, '')));
  IF v_new_status NOT IN ('active', 'suspended', 'graduated') THEN
    RAISE EXCEPTION 'Invalid student status: %. Must be active, suspended, or graduated.', COALESCE(p_new_status, '<null>') USING ERRCODE = '22023';
  END IF;

  v_expected_status := LOWER(TRIM(p_expected_status));
  IF v_expected_status IS NOT NULL AND v_expected_status NOT IN ('active', 'suspended', 'graduated') THEN
    RAISE EXCEPTION 'Invalid expected student status: %. Must be active, suspended, or graduated.', COALESCE(p_expected_status, '<null>') USING ERRCODE = '22023';
  END IF;

  SELECT id, status
  INTO v_student
  FROM public.students
  WHERE id = p_student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student record not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_student.status IS DISTINCT FROM v_expected_status THEN
    RAISE EXCEPTION 'Conflict: Student enrollment status changed concurrently (current status: %). Please refresh the directory.', v_student.status USING ERRCODE = '40001';
  END IF;

  UPDATE public.students
  SET status = v_new_status
  WHERE id = p_student_id
    AND status IS NOT DISTINCT FROM v_expected_status
  RETURNING id, status INTO v_updated_id, v_updated_status;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Conflict: Student enrollment status changed during update. Please refresh the directory.' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'id', v_updated_id,
    'status', v_updated_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_student_enrollment_status(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_student_enrollment_status(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_student_enrollment_status(UUID, TEXT, TEXT) TO authenticated;
