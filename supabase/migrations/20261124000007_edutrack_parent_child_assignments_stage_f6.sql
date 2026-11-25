-- =========================================================================
-- EduTrack Stage F.6 Migration (2026-11-24)
-- Parent Portal: Child Assignments Follow-Up (Read-Only, Privacy-Preserving)
--
-- Security, Scope & Privacy Guarantees:
-- 1. Derives parent identity from auth.uid() and verifies active link in
--    public.parent_student_links on EVERY read.
-- 2. Supports linked students even when students.user_id IS NULL (no login).
-- 3. Returns ONLY follow-up summary fields: id, title, due_at, is_past_due,
--    status ('not_submitted' | 'missed' | 'pending_grading' | 'graded'),
--    and grade ({ score, max_score } | null).
-- 4. Strictly omits answer_text, attachment metadata, object_path, bucket_id,
--    and signed URLs from the JSON response.
-- 5. Computes deadline status via database clock NOW() >= due_at, counts
--    PDF-only submissions as submitted, and counts 0/20 grades as graded.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_parent_child_assignments(p_student_id UUID)
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
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Invalid input: student_id is required.' USING ERRCODE = '22023';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_profile_role
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND OR v_profile_role IS DISTINCT FROM 'parent' THEN
    RAISE EXCEPTION 'Access denied: Verified parent profile required.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.parent_student_links l
  WHERE l.parent_id = v_uid
    AND l.student_id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Child is not linked to the authenticated parent account.' USING ERRCODE = '42501';
  END IF;

  SELECT
    s.id,
    s.group_id,
    g.name AS group_name
  INTO v_student
  FROM public.students s
  LEFT JOIN public.groups g ON g.id = s.group_id
  WHERE s.id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Linked child record is unavailable.' USING ERRCODE = '42501';
  END IF;

  IF v_student.group_id IS NULL THEN
    RETURN jsonb_build_object(
      'student_id', v_student.id,
      'assignments', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'title', a.title,
        'due_at', a.due_at,
        'is_past_due', (NOW() >= a.due_at),
        'status', CASE
          WHEN gr.id IS NOT NULL THEN 'graded'
          WHEN sub.id IS NOT NULL THEN 'pending_grading'
          WHEN NOW() >= a.due_at THEN 'missed'
          ELSE 'not_submitted'
        END,
        'grade', CASE
          WHEN gr.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'score', gr.score,
            'max_score', gr.max_score
          )
        END
      )
      ORDER BY a.due_at ASC, a.created_at DESC, a.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_assignments
  FROM public.assignments a
  LEFT JOIN public.assignment_submissions sub
    ON sub.assignment_id = a.id
   AND sub.student_id = v_student.id
  LEFT JOIN public.grades gr
    ON gr.assignment_submission_id = sub.id
  WHERE a.group_id = v_student.group_id;

  RETURN jsonb_build_object(
    'student_id', v_student.id,
    'assignments', v_assignments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_parent_child_assignments(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_child_assignments(UUID) TO authenticated;
