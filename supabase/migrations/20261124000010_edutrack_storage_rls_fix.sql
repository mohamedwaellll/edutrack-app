-- =========================================================================
-- EduTrack Corrective Migration 20261124000010
-- Fix real Supabase Storage RLS policies for Stage F.4 & F.5:
-- 1. Replace direct RLS-blocked table probes (profiles/teachers/groups/
--    assignment_attachments/assignment_submission_attachments) in
--    storage.objects policies with narrow SECURITY DEFINER helpers.
-- 2. Support Supabase Storage v1.98.7 authorization preflight metadata
--    ({mimetype, contentLength?, contentEncoding}) without requiring
--    metadata.size during INSERT preflight; bucket limits and final RPC
--    metadata checks remain authoritative.
-- 3. Preserve F5 read privacy (only admin, owning student, or assigned
--    group's teacher; owner can also see/delete their own unreferenced
--    uploads).
-- 4. Prevent DELETE from using RLS-hidden attachment references to remove
--    committed attached files.
-- =========================================================================

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS assignment_attachments_storage_teacher_insert ON storage.objects;
    DROP POLICY IF EXISTS assignment_attachments_storage_authorized_select ON storage.objects;
    DROP POLICY IF EXISTS assignment_attachments_storage_teacher_delete ON storage.objects;
    DROP POLICY IF EXISTS submission_attachments_storage_student_insert ON storage.objects;
    DROP POLICY IF EXISTS submission_attachments_storage_authorized_select ON storage.objects;
    DROP POLICY IF EXISTS submission_attachments_storage_owner_delete ON storage.objects;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.can_access_submission_object(TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.can_access_assignment_object(
  p_object_name TEXT,
  p_mode TEXT,
  p_metadata JSONB DEFAULT NULL,
  p_owner UUID DEFAULT NULL
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
  IF v_uid IS NULL OR p_object_name IS NULL OR btrim(p_object_name) = '' THEN
    RETURN FALSE;
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF p_mode = 'insert' THEN
    IF v_role IS DISTINCT FROM 'teacher' THEN
      RETURN FALSE;
    END IF;
    IF lower(p_object_name) NOT LIKE '%.pdf' OR p_object_name LIKE '%..%' THEN
      RETURN FALSE;
    END IF;
    IF COALESCE(p_metadata->>'mimetype', '') IS DISTINCT FROM 'application/pdf' THEN
      RETURN FALSE;
    END IF;
    IF p_metadata ? 'size' AND p_metadata->>'size' IS NOT NULL THEN
      IF (p_metadata->>'size') !~ '^[0-9]+$' THEN
        RETURN FALSE;
      END IF;
      v_size := (p_metadata->>'size')::bigint;
      IF v_size <= 0 OR v_size > 5242880 THEN
        RETURN FALSE;
      END IF;
    END IF;
    IF p_metadata ? 'contentLength' AND p_metadata->>'contentLength' IS NOT NULL THEN
      IF (p_metadata->>'contentLength') !~ '^[0-9]+$' THEN
        RETURN FALSE;
      END IF;
      v_size := (p_metadata->>'contentLength')::bigint;
      IF v_size <= 0 OR v_size > 5242880 THEN
        RETURN FALSE;
      END IF;
    END IF;

    v_parts := string_to_array(p_object_name, '/');
    IF array_length(v_parts, 1) < 2
       OR btrim(v_parts[1]) = ''
       OR btrim(v_parts[array_length(v_parts, 1)]) = '' THEN
      RETURN FALSE;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.teachers t
      JOIN public.groups g ON g.teacher_id = t.id
      WHERE t.user_id = v_uid
        AND g.id::text = v_parts[1]
    );
  ELSIF p_mode = 'select' THEN
    IF v_role = 'admin' THEN
      RETURN TRUE;
    ELSIF v_role = 'teacher' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.assignment_attachments att
        JOIN public.assignments a ON a.id = att.assignment_id
        JOIN public.groups g ON g.id = a.group_id
        JOIN public.teachers t ON t.id = g.teacher_id
        WHERE att.object_path = p_object_name
          AND t.user_id = v_uid
      ) OR (
        p_owner = v_uid
        AND NOT EXISTS (
          SELECT 1
          FROM public.assignment_attachments att
          WHERE att.object_path = p_object_name
        )
      );
    ELSIF v_role = 'student' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.assignment_attachments att
        JOIN public.assignments a ON a.id = att.assignment_id
        JOIN public.students s ON s.group_id = a.group_id
        WHERE att.object_path = p_object_name
          AND s.user_id = v_uid
          AND s.status = 'active'
      );
    END IF;
    RETURN FALSE;
  ELSIF p_mode = 'delete' THEN
    IF v_role = 'admin' THEN
      RETURN TRUE;
    END IF;
    RETURN (
      p_owner = v_uid
      AND NOT EXISTS (
        SELECT 1
        FROM public.assignment_attachments att
        WHERE att.object_path = p_object_name
      )
    );
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_assignment_object(TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_assignment_object(TEXT, TEXT, JSONB, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_submission_object(
  p_object_name TEXT,
  p_mode TEXT,
  p_metadata JSONB DEFAULT NULL,
  p_owner UUID DEFAULT NULL
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
  IF v_uid IS NULL OR p_object_name IS NULL OR btrim(p_object_name) = '' THEN
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
    IF p_metadata ? 'size' AND p_metadata->>'size' IS NOT NULL THEN
      IF (p_metadata->>'size') !~ '^[0-9]+$' THEN
        RETURN FALSE;
      END IF;
      v_size := (p_metadata->>'size')::bigint;
      IF v_size <= 0 OR v_size > 5242880 THEN
        RETURN FALSE;
      END IF;
    END IF;
    IF p_metadata ? 'contentLength' AND p_metadata->>'contentLength' IS NOT NULL THEN
      IF (p_metadata->>'contentLength') !~ '^[0-9]+$' THEN
        RETURN FALSE;
      END IF;
      v_size := (p_metadata->>'contentLength')::bigint;
      IF v_size <= 0 OR v_size > 5242880 THEN
        RETURN FALSE;
      END IF;
    END IF;

    v_parts := string_to_array(p_object_name, '/');
    IF array_length(v_parts, 1) < 3
       OR btrim(v_parts[1]) = ''
       OR btrim(v_parts[2]) = ''
       OR btrim(v_parts[array_length(v_parts, 1)]) = '' THEN
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
      ) OR (
        p_owner = v_uid
        AND NOT EXISTS (
          SELECT 1
          FROM public.assignment_submission_attachments att
          WHERE att.object_path = p_object_name
        )
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
  ELSIF p_mode = 'delete' THEN
    IF v_role = 'admin' THEN
      RETURN TRUE;
    END IF;
    RETURN (
      p_owner = v_uid
      AND NOT EXISTS (
        SELECT 1
        FROM public.assignment_submission_attachments att
        WHERE att.object_path = p_object_name
      )
    );
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_submission_object(TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_submission_object(TEXT, TEXT, JSONB, UUID) TO authenticated;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    CREATE POLICY assignment_attachments_storage_teacher_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'assignment-attachments'
        AND public.can_access_assignment_object(name, 'insert', metadata, owner)
      );

    CREATE POLICY assignment_attachments_storage_authorized_select
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'assignment-attachments'
        AND public.can_access_assignment_object(name, 'select', NULL, owner)
      );

    CREATE POLICY assignment_attachments_storage_teacher_delete
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'assignment-attachments'
        AND public.can_access_assignment_object(name, 'delete', NULL, owner)
      );

    CREATE POLICY submission_attachments_storage_student_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'assignment-submissions'
        AND public.can_access_submission_object(name, 'insert', metadata, owner)
      );

    CREATE POLICY submission_attachments_storage_authorized_select
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'assignment-submissions'
        AND public.can_access_submission_object(name, 'select', NULL, owner)
      );

    CREATE POLICY submission_attachments_storage_owner_delete
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'assignment-submissions'
        AND public.can_access_submission_object(name, 'delete', NULL, owner)
      );
  END IF;
END;
$$;
