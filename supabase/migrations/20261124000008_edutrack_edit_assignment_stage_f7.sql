-- =========================================================================
-- EduTrack Stage F.7 Migration (2026-11-24)
-- Assignments Phase 7: Edit Assignment Before First Submission & Due Date
--
-- Security, Concurrency & Integrity Guarantees:
-- 1. Adds explicit integer `assignment_version` (default 1) and `updated_at`
--    on `public.assignments` for optimistic concurrency across two windows.
-- 2. Acquires `FOR UPDATE` on the target `public.assignments` row inside
--    `update_teacher_assignment`, serializing atomically with
--    `submit_student_assignment` (which acquires `FOR SHARE` on that row).
-- 3. Enforces: assigned teacher for current group, original due_at not
--    passed (NOW() < v_assignment.due_at), new due_at in future, and ZERO
--    existing submissions.
-- 4. Preserves assignment ID and existing PDF attachment intact.
-- 5. Returns `{ saved: false, conflict: true, assignment: <latest> }` if
--    `p_expected_version` does not match the current `assignment_version`.
-- =========================================================================

ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS assignment_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Update create_teacher_assignment to include assignment_version in returned JSON
CREATE OR REPLACE FUNCTION public.create_teacher_assignment(
  p_group_id UUID,
  p_title TEXT,
  p_instructions TEXT,
  p_due_at TIMESTAMPTZ,
  p_attachment_path TEXT DEFAULT NULL,
  p_attachment_name TEXT DEFAULT NULL,
  p_attachment_size INTEGER DEFAULT NULL,
  p_attachment_mime_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_teacher RECORD;
  v_group RECORD;
  v_clean_title TEXT;
  v_clean_instructions TEXT;
  v_has_attachment BOOLEAN;
  v_clean_path TEXT;
  v_clean_name TEXT;
  v_clean_mime TEXT;
  v_obj RECORD;
  v_inserted RECORD;
  v_att RECORD;
  v_attachment_json JSONB := NULL;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_profile_role
  FROM public.profiles
  WHERE id = v_uid
  FOR SHARE;

  IF NOT FOUND OR v_profile_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Access denied: Verified teacher profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT id, full_name INTO v_teacher
  FROM public.teachers
  WHERE user_id = v_uid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Your account is not linked to a teacher profile.' USING ERRCODE = '42501';
  END IF;

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'Group is required.';
  END IF;

  SELECT id, name, teacher_id INTO v_group
  FROM public.groups
  WHERE id = p_group_id
  FOR SHARE;

  IF NOT FOUND OR v_group.teacher_id IS DISTINCT FROM v_teacher.id THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  v_clean_title := btrim(COALESCE(p_title, ''));
  IF v_clean_title = '' THEN
    RAISE EXCEPTION 'Assignment title is required.';
  END IF;

  v_clean_instructions := btrim(COALESCE(p_instructions, ''));
  IF v_clean_instructions = '' THEN
    RAISE EXCEPTION 'Assignment instructions are required.';
  END IF;

  IF p_due_at IS NULL OR p_due_at <= NOW() THEN
    RAISE EXCEPTION 'Due date and time must be in the future.';
  END IF;

  v_has_attachment := (
    p_attachment_path IS NOT NULL
    OR p_attachment_name IS NOT NULL
    OR p_attachment_size IS NOT NULL
    OR p_attachment_mime_type IS NOT NULL
  );

  IF v_has_attachment THEN
    v_clean_path := btrim(COALESCE(p_attachment_path, ''));
    v_clean_name := btrim(COALESCE(p_attachment_name, ''));
    v_clean_mime := lower(btrim(COALESCE(p_attachment_mime_type, '')));

    IF v_clean_path = '' OR v_clean_name = '' THEN
      RAISE EXCEPTION 'Attachment path and file name are required.';
    END IF;

    IF v_clean_path LIKE '%..%' OR v_clean_path NOT LIKE (v_group.id::text || '/%') OR lower(v_clean_path) NOT LIKE '%.pdf' THEN
      RAISE EXCEPTION 'Invalid attachment storage path.';
    END IF;

    IF v_clean_mime IS DISTINCT FROM 'application/pdf' THEN
      RAISE EXCEPTION 'Only PDF attachments are allowed.';
    END IF;

    IF p_attachment_size IS NULL OR p_attachment_size <= 0 OR p_attachment_size > 5242880 THEN
      RAISE EXCEPTION 'Attachment size must be between 1 byte and 5 MB.';
    END IF;

    IF to_regclass('storage.objects') IS NOT NULL THEN
      SELECT id, metadata
      INTO v_obj
      FROM storage.objects
      WHERE bucket_id = 'assignment-attachments'
        AND name = v_clean_path
        AND (owner IS NULL OR owner = v_uid);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Uploaded PDF attachment was not found in private storage.';
      END IF;

      IF COALESCE(v_obj.metadata->>'mimetype', '') IS DISTINCT FROM 'application/pdf' THEN
        RAISE EXCEPTION 'Only PDF attachments are allowed.';
      END IF;

      IF COALESCE((v_obj.metadata->>'size')::bigint, 0) <= 0 OR COALESCE((v_obj.metadata->>'size')::bigint, 0) > 5242880 THEN
        RAISE EXCEPTION 'Attachment size must be between 1 byte and 5 MB.';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.assignments (
    group_id,
    teacher_id,
    title,
    instructions,
    due_at
  )
  VALUES (
    v_group.id,
    v_teacher.id,
    v_clean_title,
    v_clean_instructions,
    p_due_at
  )
  RETURNING id, group_id, teacher_id, title, instructions, due_at, created_at, assignment_version
  INTO v_inserted;

  IF v_has_attachment THEN
    INSERT INTO public.assignment_attachments (
      assignment_id,
      bucket_id,
      object_path,
      file_name,
      mime_type,
      size_bytes,
      uploaded_by
    )
    VALUES (
      v_inserted.id,
      'assignment-attachments',
      v_clean_path,
      v_clean_name,
      'application/pdf',
      p_attachment_size,
      v_uid
    )
    RETURNING id, file_name, mime_type, size_bytes
    INTO v_att;

    v_attachment_json := jsonb_build_object(
      'id', v_att.id,
      'file_name', v_att.file_name,
      'mime_type', v_att.mime_type,
      'size_bytes', v_att.size_bytes
    );
  END IF;

  RETURN jsonb_build_object(
    'assignment',
    jsonb_build_object(
      'id', v_inserted.id,
      'group_id', v_inserted.group_id,
      'group_name', v_group.name,
      'teacher_id', v_inserted.teacher_id,
      'teacher_name', v_teacher.full_name,
      'title', v_inserted.title,
      'instructions', v_inserted.instructions,
      'due_at', v_inserted.due_at,
      'created_at', v_inserted.created_at,
      'assignment_version', v_inserted.assignment_version,
      'attachment', v_attachment_json
    )
  );
END;
$$;

-- Update get_teacher_assignments to include assignment_version
CREATE OR REPLACE FUNCTION public.get_teacher_assignments(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_teacher_id UUID;
  v_group RECORD;
  v_assignments JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_profile_role
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND OR v_profile_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Access denied: Verified teacher profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_teacher_id
  FROM public.teachers
  WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Your account is not linked to a teacher profile.' USING ERRCODE = '42501';
  END IF;

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'Group is required.';
  END IF;

  SELECT id, name, teacher_id INTO v_group
  FROM public.groups
  WHERE id = p_group_id;

  IF NOT FOUND OR v_group.teacher_id IS DISTINCT FROM v_teacher_id THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'group_id', a.group_id,
        'group_name', v_group.name,
        'teacher_id', a.teacher_id,
        'teacher_name', COALESCE(t.full_name, 'Teacher'),
        'title', a.title,
        'instructions', a.instructions,
        'due_at', a.due_at,
        'created_at', a.created_at,
        'assignment_version', a.assignment_version,
        'attachment', CASE
          WHEN att.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', att.id,
            'file_name', att.file_name,
            'mime_type', att.mime_type,
            'size_bytes', att.size_bytes
          )
        END
      )
      ORDER BY a.due_at ASC, a.created_at DESC, a.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_assignments
  FROM public.assignments a
  LEFT JOIN public.teachers t ON t.id = a.teacher_id
  LEFT JOIN public.assignment_attachments att ON att.assignment_id = a.id
  WHERE a.group_id = p_group_id;

  RETURN jsonb_build_object('assignments', v_assignments);
END;
$$;

-- New RPC: Edit assignment before first submission & before original due date
CREATE OR REPLACE FUNCTION public.update_teacher_assignment(
  p_assignment_id UUID,
  p_title TEXT,
  p_instructions TEXT,
  p_due_at TIMESTAMPTZ,
  p_expected_version INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_teacher RECORD;
  v_assignment RECORD;
  v_group RECORD;
  v_clean_title TEXT;
  v_clean_instructions TEXT;
  v_att RECORD;
  v_attachment_json JSONB := NULL;
  v_updated RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_profile_role
  FROM public.profiles
  WHERE id = v_uid
  FOR SHARE;

  IF NOT FOUND OR v_profile_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Access denied: Verified teacher profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT id, full_name INTO v_teacher
  FROM public.teachers
  WHERE user_id = v_uid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Your account is not linked to a teacher profile.' USING ERRCODE = '42501';
  END IF;

  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Assignment is required.';
  END IF;

  -- Lock assignment row FOR UPDATE to serialize atomically with student submission (FOR SHARE)
  -- and with concurrent edits in another teacher window.
  SELECT id, group_id, teacher_id, title, instructions, due_at, created_at, assignment_version
  INTO v_assignment
  FROM public.assignments
  WHERE id = p_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  SELECT id, name, teacher_id INTO v_group
  FROM public.groups
  WHERE id = v_assignment.group_id
  FOR SHARE;

  IF NOT FOUND OR v_group.teacher_id IS DISTINCT FROM v_teacher.id THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.assignment_submissions sub
    WHERE sub.assignment_id = v_assignment.id
  ) THEN
    RAISE EXCEPTION 'Cannot edit assignment: at least one student has already submitted.';
  END IF;

  IF NOW() >= v_assignment.due_at THEN
    RAISE EXCEPTION 'Cannot edit assignment: the original due date has already passed.';
  END IF;

  v_clean_title := btrim(COALESCE(p_title, ''));
  IF v_clean_title = '' THEN
    RAISE EXCEPTION 'Assignment title is required.';
  END IF;

  v_clean_instructions := btrim(COALESCE(p_instructions, ''));
  IF v_clean_instructions = '' THEN
    RAISE EXCEPTION 'Assignment instructions are required.';
  END IF;

  IF p_due_at IS NULL OR p_due_at <= NOW() THEN
    RAISE EXCEPTION 'Due date and time must be in the future.';
  END IF;

  SELECT id, file_name, mime_type, size_bytes
  INTO v_att
  FROM public.assignment_attachments
  WHERE assignment_id = v_assignment.id;

  IF FOUND THEN
    v_attachment_json := jsonb_build_object(
      'id', v_att.id,
      'file_name', v_att.file_name,
      'mime_type', v_att.mime_type,
      'size_bytes', v_att.size_bytes
    );
  END IF;

  IF p_expected_version IS NULL OR v_assignment.assignment_version IS DISTINCT FROM p_expected_version THEN
    RETURN jsonb_build_object(
      'saved', FALSE,
      'conflict', TRUE,
      'assignment', jsonb_build_object(
        'id', v_assignment.id,
        'group_id', v_assignment.group_id,
        'group_name', v_group.name,
        'teacher_id', v_assignment.teacher_id,
        'teacher_name', v_teacher.full_name,
        'title', v_assignment.title,
        'instructions', v_assignment.instructions,
        'due_at', v_assignment.due_at,
        'created_at', v_assignment.created_at,
        'assignment_version', v_assignment.assignment_version,
        'attachment', v_attachment_json
      )
    );
  END IF;

  UPDATE public.assignments
  SET title = v_clean_title,
      instructions = v_clean_instructions,
      due_at = p_due_at,
      assignment_version = v_assignment.assignment_version + 1,
      updated_at = NOW()
  WHERE id = v_assignment.id
  RETURNING id, group_id, teacher_id, title, instructions, due_at, created_at, assignment_version
  INTO v_updated;

  RETURN jsonb_build_object(
    'saved', TRUE,
    'conflict', FALSE,
    'assignment', jsonb_build_object(
      'id', v_updated.id,
      'group_id', v_updated.group_id,
      'group_name', v_group.name,
      'teacher_id', v_updated.teacher_id,
      'teacher_name', v_teacher.full_name,
      'title', v_updated.title,
      'instructions', v_updated.instructions,
      'due_at', v_updated.due_at,
      'created_at', v_updated.created_at,
      'assignment_version', v_updated.assignment_version,
      'attachment', v_attachment_json
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_teacher_assignment(UUID, TEXT, TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_teacher_assignment(UUID, TEXT, TEXT, TIMESTAMPTZ, INTEGER) TO authenticated;
