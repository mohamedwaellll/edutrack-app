-- =========================================================================
-- EduTrack Stage F.5 Migration (2026-11-24)
-- Assignments Phase 5: Student Submission PDF Attachments (max 5 MB)
--
-- Security, Scope & Integrity Guarantees:
-- 1. Allows student submissions to be text-only, PDF-only, or text + PDF,
--    preserving full compatibility with legacy text-only submissions.
-- 2. Stores submission PDF metadata in public.assignment_submission_attachments
--    (1:1 with assignment_submissions via UNIQUE(submission_id)) inside a
--    dedicated private bucket `assignment-submissions` (5 MB max, PDF only).
-- 3. Access to submission PDFs is strictly isolated from question sheets:
--    ONLY the owning student, the teacher currently assigned to the group,
--    or an admin can read/download. Same-group peers and parents are denied
--    at RLS, Storage object policies, and download authorization RPC layers.
-- 4. Enforces database clock NOW() < due_at on submission/replacement; failed
--    or post-due replacements leave the previous committed attachment intact.
-- =========================================================================

ALTER TABLE public.assignment_submissions
  ALTER COLUMN answer_text DROP NOT NULL;

ALTER TABLE public.assignment_submissions
  DROP CONSTRAINT IF EXISTS assignment_submissions_answer_text_check;

ALTER TABLE public.assignment_submissions
  ADD CONSTRAINT assignment_submissions_answer_text_check
  CHECK (answer_text IS NULL OR char_length(btrim(answer_text)) > 0);

CREATE TABLE IF NOT EXISTS public.assignment_submission_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL UNIQUE REFERENCES public.assignment_submissions(id) ON DELETE CASCADE,
  bucket_id TEXT NOT NULL DEFAULT 'assignment-submissions' CHECK (bucket_id = 'assignment-submissions'),
  object_path TEXT NOT NULL UNIQUE CHECK (char_length(btrim(object_path)) > 0),
  file_name TEXT NOT NULL CHECK (char_length(btrim(file_name)) > 0),
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_submission_attachments_submission_id
  ON public.assignment_submission_attachments (submission_id);

ALTER TABLE public.assignment_submission_attachments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.assignment_submission_attachments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignment_submission_attachments TO authenticated;

DROP POLICY IF EXISTS submission_attachments_admin_all ON public.assignment_submission_attachments;
CREATE POLICY submission_attachments_admin_all
  ON public.assignment_submission_attachments
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS submission_attachments_owner_student_select ON public.assignment_submission_attachments;
CREATE POLICY submission_attachments_owner_student_select
  ON public.assignment_submission_attachments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.assignment_submissions sub
      JOIN public.students s ON s.id = sub.student_id
      JOIN public.profiles p ON p.id = s.user_id
      WHERE sub.id = assignment_submission_attachments.submission_id
        AND p.id = auth.uid()
        AND p.role = 'student'
    )
  );

DROP POLICY IF EXISTS submission_attachments_teacher_select ON public.assignment_submission_attachments;
CREATE POLICY submission_attachments_teacher_select
  ON public.assignment_submission_attachments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.assignment_submissions sub
      JOIN public.assignments a ON a.id = sub.assignment_id
      JOIN public.groups g ON g.id = a.group_id
      JOIN public.teachers t ON t.id = g.teacher_id
      JOIN public.profiles p ON p.id = t.user_id
      WHERE sub.id = assignment_submission_attachments.submission_id
        AND p.id = auth.uid()
        AND p.role = 'teacher'
    )
  );

-- Helper SECURITY DEFINER function for storage.objects RLS on assignment-submissions
CREATE OR REPLACE FUNCTION public.can_access_submission_object(
  p_object_name TEXT,
  p_mode TEXT,
  p_metadata JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_role public.user_role;
  v_parts TEXT[];
  v_size BIGINT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_object_name IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF p_mode = 'insert' THEN
    IF v_role IS DISTINCT FROM 'student' THEN
      RETURN FALSE;
    END IF;
    IF lower(p_object_name) NOT LIKE '%.pdf' OR p_object_name LIKE '%..%' THEN
      RETURN FALSE;
    END IF;
    IF COALESCE(p_metadata->>'mimetype', '') IS DISTINCT FROM 'application/pdf' THEN
      RETURN FALSE;
    END IF;
    v_size := COALESCE((p_metadata->>'size')::bigint, 0);
    IF v_size <= 0 OR v_size > 5242880 THEN
      RETURN FALSE;
    END IF;
    v_parts := string_to_array(p_object_name, '/');
    IF array_length(v_parts, 1) < 3 THEN
      RETURN FALSE;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.students s
      JOIN public.assignments a ON a.group_id = s.group_id
      WHERE s.user_id = v_uid
        AND s.status = 'active'
        AND s.id::text = v_parts[1]
        AND a.id::text = v_parts[2]
        AND NOW() < a.due_at
    );
  ELSIF p_mode = 'select' THEN
    IF v_role = 'admin' THEN
      RETURN TRUE;
    ELSIF v_role = 'student' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.assignment_submission_attachments att
        JOIN public.assignment_submissions sub ON sub.id = att.submission_id
        JOIN public.students s ON s.id = sub.student_id
        WHERE att.object_path = p_object_name
          AND s.user_id = v_uid
      );
    ELSIF v_role = 'teacher' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.assignment_submission_attachments att
        JOIN public.assignment_submissions sub ON sub.id = att.submission_id
        JOIN public.assignments a ON a.id = sub.assignment_id
        JOIN public.groups g ON g.id = a.group_id
        JOIN public.teachers t ON t.id = g.teacher_id
        WHERE att.object_path = p_object_name
          AND t.user_id = v_uid
      );
    END IF;
    RETURN FALSE;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_submission_object(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_submission_object(TEXT, TEXT, JSONB) TO authenticated;

-- Configure private Supabase Storage bucket `assignment-submissions` & RLS policies
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'assignment-submissions',
      'assignment-submissions',
      false,
      5242880,
      ARRAY['application/pdf']
    )
    ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = 5242880,
        allowed_mime_types = ARRAY['application/pdf'];

    DROP POLICY IF EXISTS submission_attachments_storage_student_insert ON storage.objects;
    CREATE POLICY submission_attachments_storage_student_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'assignment-submissions'
        AND public.can_access_submission_object(name, 'insert', metadata)
      );

    DROP POLICY IF EXISTS submission_attachments_storage_authorized_select ON storage.objects;
    CREATE POLICY submission_attachments_storage_authorized_select
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'assignment-submissions'
        AND public.can_access_submission_object(name, 'select', NULL)
      );

    DROP POLICY IF EXISTS submission_attachments_storage_owner_delete ON storage.objects;
    CREATE POLICY submission_attachments_storage_owner_delete
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'assignment-submissions'
        AND (
          public.is_admin()
          OR (
            owner = auth.uid()
            AND NOT EXISTS (
              SELECT 1
              FROM public.assignment_submission_attachments att
              WHERE att.object_path = storage.objects.name
            )
          )
        )
      );
  END IF;
END;
$$;

-- Replace 2-arg submit_student_assignment with text + optional PDF attachment support
DROP FUNCTION IF EXISTS public.submit_student_assignment(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.submit_student_assignment(
  p_assignment_id UUID,
  p_answer_text TEXT DEFAULT NULL,
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
  v_student RECORD;
  v_assignment RECORD;
  v_clean_answer TEXT;
  v_has_new_attachment BOOLEAN;
  v_clean_path TEXT;
  v_clean_name TEXT;
  v_clean_mime TEXT;
  v_obj RECORD;
  v_existing_sub_id UUID := NULL;
  v_existing_att_id UUID := NULL;
  v_existing_att_path TEXT := NULL;
  v_existing_att_name TEXT := NULL;
  v_existing_att_mime TEXT := NULL;
  v_existing_att_size INTEGER := NULL;
  v_previous_path TEXT := NULL;
  v_saved RECORD;
  v_saved_att RECORD;
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

  IF NOT FOUND OR v_profile_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Access denied: Verified student profile required.' USING ERRCODE = '42501';
  END IF;

  SELECT id, group_id, status
  INTO v_student
  FROM public.students
  WHERE user_id = v_uid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Your account is not linked to a student record.' USING ERRCODE = '42501';
  END IF;

  IF v_student.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Access denied: Only active students can submit assignments.' USING ERRCODE = '42501';
  END IF;

  IF v_student.group_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: You are not assigned to a class group.' USING ERRCODE = '42501';
  END IF;

  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Assignment is required.';
  END IF;

  SELECT id, group_id, due_at
  INTO v_assignment
  FROM public.assignments
  WHERE id = p_assignment_id
  FOR SHARE;

  IF NOT FOUND OR v_assignment.group_id IS DISTINCT FROM v_student.group_id THEN
    RAISE EXCEPTION 'Access denied: This assignment does not belong to your current group.' USING ERRCODE = '42501';
  END IF;

  IF NOW() >= v_assignment.due_at THEN
    RAISE EXCEPTION 'Submission deadline has passed.';
  END IF;

  v_clean_answer := NULLIF(btrim(COALESCE(p_answer_text, '')), '');

  v_has_new_attachment := (
    p_attachment_path IS NOT NULL
    OR p_attachment_name IS NOT NULL
    OR p_attachment_size IS NOT NULL
    OR p_attachment_mime_type IS NOT NULL
  );

  IF v_has_new_attachment THEN
    v_clean_path := btrim(COALESCE(p_attachment_path, ''));
    v_clean_name := btrim(COALESCE(p_attachment_name, ''));
    v_clean_mime := lower(btrim(COALESCE(p_attachment_mime_type, '')));

    IF v_clean_path = '' OR v_clean_name = '' THEN
      RAISE EXCEPTION 'Attachment path and file name are required.';
    END IF;

    IF v_clean_path LIKE '%..%'
       OR v_clean_path NOT LIKE (v_student.id::text || '/' || v_assignment.id::text || '/%')
       OR lower(v_clean_path) NOT LIKE '%.pdf' THEN
      RAISE EXCEPTION 'Invalid submission attachment storage path.';
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
      WHERE bucket_id = 'assignment-submissions'
        AND name = v_clean_path
        AND (owner IS NULL OR owner = v_uid);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Uploaded submission PDF was not found in private storage.';
      END IF;

      IF COALESCE(v_obj.metadata->>'mimetype', '') IS DISTINCT FROM 'application/pdf' THEN
        RAISE EXCEPTION 'Only PDF attachments are allowed.';
      END IF;

      IF COALESCE((v_obj.metadata->>'size')::bigint, 0) <= 0 OR COALESCE((v_obj.metadata->>'size')::bigint, 0) > 5242880 THEN
        RAISE EXCEPTION 'Attachment size must be between 1 byte and 5 MB.';
      END IF;
    END IF;
  END IF;

  SELECT id
  INTO v_existing_sub_id
  FROM public.assignment_submissions
  WHERE assignment_id = v_assignment.id
    AND student_id = v_student.id
  FOR UPDATE;

  IF v_existing_sub_id IS NOT NULL THEN
    SELECT id, object_path, file_name, mime_type, size_bytes
    INTO v_existing_att_id, v_existing_att_path, v_existing_att_name, v_existing_att_mime, v_existing_att_size
    FROM public.assignment_submission_attachments
    WHERE submission_id = v_existing_sub_id
    FOR UPDATE;
  END IF;

  IF v_clean_answer IS NULL AND NOT v_has_new_attachment AND v_existing_att_id IS NULL THEN
    RAISE EXCEPTION 'Answer text is required unless a PDF attachment is provided.';
  END IF;

  INSERT INTO public.assignment_submissions (
    assignment_id,
    student_id,
    answer_text,
    submitted_at,
    updated_at
  )
  VALUES (
    v_assignment.id,
    v_student.id,
    v_clean_answer,
    NOW(),
    NOW()
  )
  ON CONFLICT (assignment_id, student_id)
  DO UPDATE SET
    answer_text = EXCLUDED.answer_text,
    updated_at = NOW()
  RETURNING id, assignment_id, student_id, answer_text, submitted_at, updated_at
  INTO v_saved;

  IF v_has_new_attachment THEN
    IF v_existing_att_id IS NOT NULL AND v_existing_att_path IS DISTINCT FROM v_clean_path THEN
      v_previous_path := v_existing_att_path;
    END IF;

    INSERT INTO public.assignment_submission_attachments (
      submission_id,
      bucket_id,
      object_path,
      file_name,
      mime_type,
      size_bytes,
      uploaded_by,
      updated_at
    )
    VALUES (
      v_saved.id,
      'assignment-submissions',
      v_clean_path,
      v_clean_name,
      'application/pdf',
      p_attachment_size,
      v_uid,
      NOW()
    )
    ON CONFLICT (submission_id)
    DO UPDATE SET
      object_path = EXCLUDED.object_path,
      file_name = EXCLUDED.file_name,
      mime_type = EXCLUDED.mime_type,
      size_bytes = EXCLUDED.size_bytes,
      uploaded_by = EXCLUDED.uploaded_by,
      updated_at = NOW()
    RETURNING id, file_name, mime_type, size_bytes
    INTO v_saved_att;

    v_attachment_json := jsonb_build_object(
      'id', v_saved_att.id,
      'file_name', v_saved_att.file_name,
      'mime_type', v_saved_att.mime_type,
      'size_bytes', v_saved_att.size_bytes
    );
  ELSIF v_existing_att_id IS NOT NULL THEN
    v_attachment_json := jsonb_build_object(
      'id', v_existing_att_id,
      'file_name', v_existing_att_name,
      'mime_type', v_existing_att_mime,
      'size_bytes', v_existing_att_size
    );
  END IF;

  RETURN jsonb_build_object(
    'submission',
    jsonb_build_object(
      'id', v_saved.id,
      'assignment_id', v_saved.assignment_id,
      'answer_text', v_saved.answer_text,
      'submitted_at', v_saved.submitted_at,
      'updated_at', v_saved.updated_at,
      'attachment', v_attachment_json
    ),
    'previous_object_path', v_previous_path
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_student_assignment(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_student_assignment(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) TO authenticated;

-- Update get_student_assignments to include submission.attachment
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
            'updated_at', sub.updated_at,
            'attachment', CASE
              WHEN sub_att.id IS NULL THEN NULL
              ELSE jsonb_build_object(
                'id', sub_att.id,
                'file_name', sub_att.file_name,
                'mime_type', sub_att.mime_type,
                'size_bytes', sub_att.size_bytes
              )
            END
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
  LEFT JOIN public.assignment_submission_attachments sub_att
    ON sub_att.submission_id = sub.id
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

-- Update get_teacher_assignment_submissions to include submission attachment
CREATE OR REPLACE FUNCTION public.get_teacher_assignment_submissions(p_assignment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_teacher_id UUID;
  v_assignment RECORD;
  v_submissions JSONB;
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

  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Assignment is required.';
  END IF;

  SELECT
    a.id,
    a.title,
    a.group_id,
    a.due_at,
    g.name AS group_name,
    g.teacher_id AS group_teacher_id
  INTO v_assignment
  FROM public.assignments a
  JOIN public.groups g ON g.id = a.group_id
  WHERE a.id = p_assignment_id;

  IF NOT FOUND OR v_assignment.group_teacher_id IS DISTINCT FROM v_teacher_id THEN
    RAISE EXCEPTION 'Access denied: This group is not assigned to your teacher account.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sub.id,
        'assignment_id', sub.assignment_id,
        'student_id', s.id,
        'student_name', s.full_name,
        'student_code', s.student_code,
        'answer_text', sub.answer_text,
        'submitted_at', sub.submitted_at,
        'updated_at', sub.updated_at,
        'attachment', CASE
          WHEN sub_att.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', sub_att.id,
            'file_name', sub_att.file_name,
            'mime_type', sub_att.mime_type,
            'size_bytes', sub_att.size_bytes
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
      ORDER BY sub.updated_at DESC, s.full_name ASC, sub.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_submissions
  FROM public.assignment_submissions sub
  JOIN public.students s ON s.id = sub.student_id
  LEFT JOIN public.assignment_submission_attachments sub_att ON sub_att.submission_id = sub.id
  LEFT JOIN public.grades gr ON gr.assignment_submission_id = sub.id
  WHERE sub.assignment_id = v_assignment.id;

  RETURN jsonb_build_object(
    'assignment',
    jsonb_build_object(
      'id', v_assignment.id,
      'title', v_assignment.title,
      'group_id', v_assignment.group_id,
      'group_name', v_assignment.group_name,
      'due_at', v_assignment.due_at,
      'can_grade', (NOW() >= v_assignment.due_at)
    ),
    'submissions', v_submissions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_assignment_submissions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_assignment_submissions(UUID) TO authenticated;

-- Strictly isolated download authorization for student submission PDFs
-- Owning student OR assigned group's teacher OR admin ONLY (peers & parents denied)
CREATE OR REPLACE FUNCTION public.authorize_submission_attachment_download(
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
  v_student_id UUID;
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
    att.submission_id,
    att.bucket_id,
    att.object_path,
    att.file_name,
    att.mime_type,
    att.size_bytes,
    sub.student_id,
    a.group_id
  INTO v_att
  FROM public.assignment_submission_attachments att
  JOIN public.assignment_submissions sub ON sub.id = att.submission_id
  JOIN public.assignments a ON a.id = sub.assignment_id
  WHERE att.id = p_attachment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: You are not authorized to access this submission attachment.' USING ERRCODE = '42501';
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
    SELECT id INTO v_student_id
    FROM public.students
    WHERE user_id = v_uid;

    IF v_student_id IS NULL OR v_student_id IS DISTINCT FROM v_att.student_id THEN
      RAISE EXCEPTION 'Access denied: You can only open your own submission attachment.' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Access denied: You are not authorized to access this submission attachment.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'attachment',
    jsonb_build_object(
      'id', v_att.id,
      'submission_id', v_att.submission_id,
      'bucket_id', v_att.bucket_id,
      'object_path', v_att.object_path,
      'file_name', v_att.file_name,
      'mime_type', v_att.mime_type,
      'size_bytes', v_att.size_bytes
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_submission_attachment_download(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_submission_attachment_download(UUID) TO authenticated;
