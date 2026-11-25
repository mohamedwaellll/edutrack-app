-- =========================================================================
-- EduTrack Stage F.8 Migration (2026-11-24)
-- Assignments Phase 8: Assignment Version Check on Student Submission
--
-- Security, Concurrency & Integrity Guarantees:
-- 1. Updates get_student_assignments() to return `assignment_version`.
-- 2. Updates submit_student_assignment() to accept optional
--    `p_expected_assignment_version` and compare it against
--    `public.assignments.assignment_version` under the `FOR SHARE` row lock.
-- 3. If the assignment was edited after the student started drafting
--    (version mismatch), returns `{ saved: false, conflict: true,
--    assignment: { id, title, instructions, due_at, assignment_version,
--    is_past_due } }` WITHOUT inserting or updating any submission.
-- 4. Preserves normal submission when p_expected_assignment_version matches
--    or is omitted (NULL).
-- =========================================================================

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
        'assignment_version', a.assignment_version,
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

-- Replace 6-arg submit_student_assignment with 7-arg version checking p_expected_assignment_version
DROP FUNCTION IF EXISTS public.submit_student_assignment(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.submit_student_assignment(
  p_assignment_id UUID,
  p_answer_text TEXT DEFAULT NULL,
  p_attachment_path TEXT DEFAULT NULL,
  p_attachment_name TEXT DEFAULT NULL,
  p_attachment_size INTEGER DEFAULT NULL,
  p_attachment_mime_type TEXT DEFAULT NULL,
  p_expected_assignment_version INTEGER DEFAULT NULL
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

  SELECT id, group_id, title, instructions, due_at, assignment_version
  INTO v_assignment
  FROM public.assignments
  WHERE id = p_assignment_id
  FOR SHARE;

  IF NOT FOUND OR v_assignment.group_id IS DISTINCT FROM v_student.group_id THEN
    RAISE EXCEPTION 'Access denied: This assignment does not belong to your current group.' USING ERRCODE = '42501';
  END IF;

  IF p_expected_assignment_version IS NOT NULL
     AND v_assignment.assignment_version IS DISTINCT FROM p_expected_assignment_version THEN
    RETURN jsonb_build_object(
      'saved', FALSE,
      'conflict', TRUE,
      'assignment', jsonb_build_object(
        'id', v_assignment.id,
        'title', v_assignment.title,
        'instructions', v_assignment.instructions,
        'due_at', v_assignment.due_at,
        'assignment_version', v_assignment.assignment_version,
        'is_past_due', (NOW() >= v_assignment.due_at)
      )
    );
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
    'saved', TRUE,
    'conflict', FALSE,
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

REVOKE ALL ON FUNCTION public.submit_student_assignment(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_student_assignment(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER) TO authenticated;
