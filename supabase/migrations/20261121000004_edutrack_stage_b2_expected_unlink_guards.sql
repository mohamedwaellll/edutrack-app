-- =========================================================================
-- EduTrack Stage B.2 Migration (2026-11-21)
-- Expected User ID Verification on Unlink Confirmation (Stale Unlink Protection)
--
-- Migration Order & Precedence:
-- 1. Must run strictly AFTER:
--    20261121000003_edutrack_stage_b1_corrective_hardening.sql
--
-- Features Implemented:
-- 1. Updates unlink_teacher_account(p_teacher_id UUID, p_expected_user_id UUID DEFAULT NULL):
--    - Drops the 1-arg signature so default-arg 2-arg signature replaces it cleanly
--      without PostgreSQL function overload ambiguity.
--    - Preserves legacy 1-arg calls (p_expected_user_id IS NULL).
--    - When p_expected_user_id is provided (UI confirmation flow), acquires FOR UPDATE
--      on the teacher row and verifies current user_id matches p_expected_user_id.
--    - If the link changed or was removed concurrently, preserves the current link
--      untouched and raises a Conflict exception prompting UI refresh.
-- 2. Updates unlink_student_account(p_student_id UUID, p_expected_user_id UUID DEFAULT NULL):
--    - Same atomic FOR UPDATE + p_expected_user_id verification and conflict protection.
-- 3. Re-affirms least-privilege EXECUTE grants (authenticated only, revoked from PUBLIC/anon).
-- =========================================================================

-- 1. Replace 1-arg unlink_teacher_account with backwards-compatible 2-arg signature
DROP FUNCTION IF EXISTS public.unlink_teacher_account(UUID);

CREATE OR REPLACE FUNCTION public.unlink_teacher_account(
  p_teacher_id UUID,
  p_expected_user_id UUID DEFAULT NULL
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

  -- Lock teacher row FOR UPDATE to serialize concurrent link/unlink calls
  SELECT user_id INTO v_previous_user_id
  FROM public.teachers
  WHERE id = p_teacher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Teacher record not found';
  END IF;

  -- Verify expected linked user ID when supplied from confirmation UI
  IF p_expected_user_id IS NOT NULL THEN
    IF v_previous_user_id IS DISTINCT FROM p_expected_user_id THEN
      IF v_previous_user_id IS NULL THEN
        RAISE EXCEPTION 'Conflict: Teacher link state changed before confirmation completed (link was already removed). Please refresh the list.';
      ELSE
        RAISE EXCEPTION 'Conflict: Teacher link changed to another user account (%). Current link preserved; please refresh the list.', v_previous_user_id;
      END IF;
    END IF;
  ELSIF v_previous_user_id IS NULL THEN
    -- Preserve backwards-compatible 1-arg idempotent behavior when already unlinked
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
    AND (p_expected_user_id IS NULL OR user_id = p_expected_user_id)
  RETURNING id, user_id INTO v_updated_id, v_after_user_id;

  IF v_updated_id IS NULL OR v_after_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Conflict: Teacher link state changed during unlink operation. Please refresh the list.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'teacher_id', v_updated_id,
    'previous_user_id', v_previous_user_id
  );
END;
$$;

-- 2. Replace 1-arg unlink_student_account with backwards-compatible 2-arg signature
DROP FUNCTION IF EXISTS public.unlink_student_account(UUID);

CREATE OR REPLACE FUNCTION public.unlink_student_account(
  p_student_id UUID,
  p_expected_user_id UUID DEFAULT NULL
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

  -- Lock student row FOR UPDATE to serialize concurrent link/unlink calls
  SELECT user_id INTO v_previous_user_id
  FROM public.students
  WHERE id = p_student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student record not found';
  END IF;

  -- Verify expected linked user ID when supplied from confirmation UI
  IF p_expected_user_id IS NOT NULL THEN
    IF v_previous_user_id IS DISTINCT FROM p_expected_user_id THEN
      IF v_previous_user_id IS NULL THEN
        RAISE EXCEPTION 'Conflict: Student link state changed before confirmation completed (link was already removed). Please refresh the list.';
      ELSE
        RAISE EXCEPTION 'Conflict: Student link changed to another user account (%). Current link preserved; please refresh the list.', v_previous_user_id;
      END IF;
    END IF;
  ELSIF v_previous_user_id IS NULL THEN
    -- Preserve backwards-compatible 1-arg idempotent behavior when already unlinked
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
    AND (p_expected_user_id IS NULL OR user_id = p_expected_user_id)
  RETURNING id, user_id INTO v_updated_id, v_after_user_id;

  IF v_updated_id IS NULL OR v_after_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Conflict: Student link state changed during unlink operation. Please refresh the list.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_updated_id,
    'previous_user_id', v_previous_user_id
  );
END;
$$;

-- 3. Re-affirm RPC Execute Privileges
REVOKE ALL ON FUNCTION public.unlink_teacher_account(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_student_account(UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.unlink_teacher_account(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_student_account(UUID, UUID) TO authenticated;
