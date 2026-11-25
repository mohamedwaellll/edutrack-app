-- =========================================================================
-- EduTrack Stage F.4 Migration (2026-11-24)
-- Assignments Phase 4: Optional PDF Attachments (max 5 MB, private bucket)
--
-- Security & Integrity Guarantees:
-- 1. Stores attachment metadata in public.assignment_attachments linked 1:1
--    to public.assignments (ON DELETE CASCADE, UNIQUE(assignment_id)).
-- 2. Enforces PDF-only (application/pdf) and 5 MB max (5242880 bytes) at both
--    table constraints, Storage bucket/object policies, and RPC validation.
-- 3. Re-verifies teacher group ownership or active student current group
--    membership on every download authorization request via
--    authorize_assignment_attachment_download(p_attachment_id).
-- 4. Preserves backwards compatibility for text-only and legacy assignments.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.assignment_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL UNIQUE REFERENCES public.assignments(id) ON DELETE CASCADE,
  bucket_id TEXT NOT NULL DEFAULT 'assignment-attachments' CHECK (bucket_id = 'assignment-attachments'),
  object_path TEXT NOT NULL UNIQUE CHECK (char_length(btrim(object_path)) > 0),
  file_name TEXT NOT NULL CHECK (char_length(btrim(file_name)) > 0),
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_attachments_assignment_id
  ON public.assignment_attachments (assignment_id);

ALTER TABLE public.assignment_attachments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.assignment_attachments FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.assignment_attachments TO authenticated;

DROP POLICY IF EXISTS assignment_attachments_admin_all ON public.assignment_attachments;
CREATE POLICY assignment_attachments_admin_all
  ON public.assignment_attachments
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS assignment_attachments_teacher_select ON public.assignment_attachments;
CREATE POLICY assignment_attachments_teacher_select
  ON public.assignment_attachments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.groups g ON g.id = a.group_id
      JOIN public.teachers t ON t.id = g.teacher_id
      JOIN public.profiles p ON p.id = t.user_id
      WHERE a.id = assignment_attachments.assignment_id
        AND p.id = auth.uid()
        AND p.role = 'teacher'
    )
  );

DROP POLICY IF EXISTS assignment_attachments_student_select ON public.assignment_attachments;
CREATE POLICY assignment_attachments_student_select
  ON public.assignment_attachments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.students s ON s.group_id = a.group_id
      JOIN public.profiles p ON p.id = s.user_id
      WHERE a.id = assignment_attachments.assignment_id
        AND p.id = auth.uid()
        AND p.role = 'student'
        AND s.status = 'active'
    )
  );

-- Configure private Supabase Storage bucket & RLS policies when storage schema exists
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'assignment-attachments',
      'assignment-attachments',
      false,
      5242880,
      ARRAY['application/pdf']
    )
    ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = 5242880,
        allowed_mime_types = ARRAY['application/pdf'];

    DROP POLICY IF EXISTS assignment_attachments_storage_teacher_insert ON storage.objects;
    CREATE POLICY assignment_attachments_storage_teacher_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'assignment-attachments'
        AND lower(storage.extension(name)) = 'pdf'
        AND COALESCE(metadata->>'mimetype', '') = 'application/pdf'
        AND COALESCE((metadata->>'size')::bigint, 0) > 0
        AND COALESCE((metadata->>'size')::bigint, 0) <= 5242880
        AND EXISTS (
          SELECT 1
          FROM public.profiles p
          JOIN public.teachers t ON t.user_id = p.id
          JOIN public.groups g ON g.teacher_id = t.id
          WHERE p.id = auth.uid()
            AND p.role = 'teacher'
            AND g.id::text = (storage.foldername(name))[1]
        )
      );

    DROP POLICY IF EXISTS assignment_attachments_storage_authorized_select ON storage.objects;
    CREATE POLICY assignment_attachments_storage_authorized_select
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'assignment-attachments'
        AND (
          public.is_admin()
          OR EXISTS (
            SELECT 1
            FROM public.assignment_attachments att
            JOIN public.assignments a ON a.id = att.assignment_id
            JOIN public.groups g ON g.id = a.group_id
            JOIN public.teachers t ON t.id = g.teacher_id
            JOIN public.profiles p ON p.id = t.user_id
            WHERE att.object_path = storage.objects.name
              AND p.id = auth.uid()
              AND p.role = 'teacher'
          )
          OR EXISTS (
            SELECT 1
            FROM public.assignment_attachments att
            JOIN public.assignments a ON a.id = att.assignment_id
            JOIN public.students s ON s.group_id = a.group_id
            JOIN public.profiles p ON p.id = s.user_id
            WHERE att.object_path = storage.objects.name
              AND p.id = auth.uid()
              AND p.role = 'student'
              AND s.status = 'active'
          )
        )
      );

    DROP POLICY IF EXISTS assignment_attachments_storage_teacher_delete ON storage.objects;
    CREATE POLICY assignment_attachments_storage_teacher_delete
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'assignment-attachments'
        AND (
          public.is_admin()
          OR (
            owner = auth.uid()
            AND NOT EXISTS (
              SELECT 1
              FROM public.assignment_attachments att
              WHERE att.object_path = storage.objects.name
            )
          )
        )
      );
  END IF;
END;
$$;

-- Replace 4-arg create_teacher_assignment with optional attachment parameters
DROP FUNCTION IF EXISTS public.create_teacher_assignment(UUID, TEXT, TEXT, TIMESTAMPTZ);

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
  RETURNING id, group_id, teacher_id, title, instructions, due_at, created_at
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
      'attachment', v_attachment_json
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_teacher_assignment(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_teacher_assignment(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, INTEGER, TEXT) TO authenticated;

-- Update get_teacher_assignments to include optional attachment
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

REVOKE ALL ON FUNCTION public.get_teacher_assignments(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_assignments(UUID) TO authenticated;

-- Update get_student_assignments to include optional attachment (preserving submission + grade_version)
CREATE OR REPLACE FUNCTION public.get_student_assignments()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_student RECORD;
  v_assignments JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_profile_role
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND OR v_profile_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Access denied: Verified student profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT
    s.id,
    s.group_id,
    g.name AS group_name
  INTO v_student
  FROM public.students s
  LEFT JOIN public.groups g ON g.id = s.group_id
  WHERE s.user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'linked', FALSE,
      'assignments', '[]'::jsonb
    );
  END IF;

  IF v_student.group_id IS NULL THEN
    RETURN jsonb_build_object(
      'linked', TRUE,
      'assignments', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'group_id', a.group_id,
        'group_name', COALESCE(v_student.group_name, ''),
        'title', a.title,
        'instructions', a.instructions,
        'due_at', a.due_at,
        'created_at', a.created_at,
        'is_past_due', (NOW() >= a.due_at),
        'attachment', CASE
          WHEN att.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', att.id,
            'file_name', att.file_name,
            'mime_type', att.mime_type,
            'size_bytes', att.size_bytes
          )
        END,
        'submission', CASE
          WHEN sub.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', sub.id,
            'answer_text', sub.answer_text,
            'submitted_at', sub.submitted_at,
            'updated_at', sub.updated_at
          )
        END,
        'grade', CASE
          WHEN gr.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', gr.id,
            'score', gr.score,
            'max_score', gr.max_score,
            'assessment_date', gr.assessment_date,
            'updated_at', gr.updated_at,
            'grade_version', gr.grade_version
          )
        END
      )
      ORDER BY a.due_at ASC, a.created_at DESC, a.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_assignments
  FROM public.assignments a
  LEFT JOIN public.assignment_attachments att
    ON att.assignment_id = a.id
  LEFT JOIN public.assignment_submissions sub
    ON sub.assignment_id = a.id
   AND sub.student_id = v_student.id
  LEFT JOIN public.grades gr
    ON gr.assignment_submission_id = sub.id
  WHERE a.group_id = v_student.group_id;

  RETURN jsonb_build_object(
    'linked', TRUE,
    'assignments', v_assignments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_assignments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_assignments() TO authenticated;

-- Re-verify current authorization before returning attachment storage target
CREATE OR REPLACE FUNCTION public.authorize_assignment_attachment_download(
  p_attachment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_att RECORD;
  v_teacher_id UUID;
  v_group_teacher_id UUID;
  v_student RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF p_attachment_id IS NULL THEN
    RAISE EXCEPTION 'Attachment ID is required.';
  END IF;

  SELECT role INTO v_profile_role
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Verified profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT
    att.id,
    att.assignment_id,
    att.bucket_id,
    att.object_path,
    att.file_name,
    att.mime_type,
    att.size_bytes,
    a.group_id
  INTO v_att
  FROM public.assignment_attachments att
  JOIN public.assignments a ON a.id = att.assignment_id
  WHERE att.id = p_attachment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to access this attachment.' USING ERRCODE = '42501';
  END IF;

  IF v_profile_role = 'admin' THEN
    NULL;
  ELSIF v_profile_role = 'teacher' THEN
    SELECT id INTO v_teacher_id
    FROM public.teachers
    WHERE user_id = v_uid;

    SELECT teacher_id INTO v_group_teacher_id
    FROM public.groups
    WHERE id = v_att.group_id;

    IF v_teacher_id IS NULL OR v_group_teacher_id IS DISTINCT FROM v_teacher_id THEN
      RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile_role = 'student' THEN
    SELECT id, group_id, status INTO v_student
    FROM public.students
    WHERE user_id = v_uid;

    IF NOT FOUND OR v_student.status IS DISTINCT FROM 'active' OR v_student.group_id IS DISTINCT FROM v_att.group_id THEN
      RAISE EXCEPTION 'Access denied: You are not enrolled in this assignment''s current group.' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Access denied: You are not authorized to access this attachment.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'attachment',
    jsonb_build_object(
      'id', v_att.id,
      'assignment_id', v_att.assignment_id,
      'bucket_id', v_att.bucket_id,
      'object_path', v_att.object_path,
      'file_name', v_att.file_name,
      'mime_type', v_att.mime_type,
      'size_bytes', v_att.size_bytes
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_assignment_attachment_download(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_assignment_attachment_download(UUID) TO authenticated;
