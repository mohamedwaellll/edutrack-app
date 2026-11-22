-- =========================================================================
-- EduTrack Stage E Migration (2026-11-22)
-- Scoped Read-Only Parent Portal RPCs (Linked Children, Attendance, Grades & Parent-Visible Notes)
--
-- Migration Order & Precedence:
-- 1. Must run strictly AFTER:
--    20261121000007_edutrack_stage_d_student_read_only_portal.sql
--
-- Security, Privacy & Data Scope Guarantees:
-- 1. Parent identity is ALWAYS derived server-side from:
--      auth.uid() -> public.profiles (role = 'parent')
--    Child access requires an active row in public.parent_student_links
--    for (parent_id = auth.uid(), student_id = p_student_id) verified on EVERY read.
-- 2. Linked children are returned even when students.user_id IS NULL (no student login required).
-- 3. Child cards expose ONLY id, full_name, student_code, grade_level, status,
--    and current group summary (id, name, grade_level) if assigned.
-- 4. Attendance returns ONLY the linked child's recorded entries (date DESC).
-- 5. Grades return ONLY the linked child's saved grades (assessment_date DESC).
-- 6. Teacher notes filter strictly WHERE tn.is_parent_visible IS TRUE INSIDE SQL
--    before payload construction; internal notes (false or NULL) NEVER enter the JSON output.
--    Note payloads expose ONLY id, author_name (teachers.full_name), feedback_text,
--    note_date, and created_at.
-- 7. Strictly OMITS qr_code_hash, parent_name, parent_phone, user_id, remarks,
--    and all unlinked or internal records.
-- 8. Direct table RLS policies remain unchanged (admin-only), preserving
--    existing Admin, Stage C Teacher, and Stage D Student workflows.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_parent_portal_children()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_children JSONB;
BEGIN
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

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'full_name', s.full_name,
        'student_code', s.student_code,
        'grade_level', s.grade_level,
        'status', s.status,
        'group', CASE
          WHEN g.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', g.id,
            'name', g.name,
            'grade_level', g.grade_level
          )
        END
      )
      ORDER BY s.full_name ASC, s.student_code ASC, s.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_children
  FROM public.parent_student_links l
  JOIN public.students s ON s.id = l.student_id
  LEFT JOIN public.groups g ON g.id = s.group_id
  WHERE l.parent_id = v_uid;

  RETURN jsonb_build_object('children', v_children);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_parent_child_details(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_student RECORD;
  v_attendance JSONB;
  v_grades JSONB;
  v_notes JSONB;
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
    s.full_name,
    s.student_code,
    s.grade_level,
    s.status,
    s.group_id,
    g.name AS group_name,
    g.grade_level AS group_grade_level
  INTO v_student
  FROM public.students s
  LEFT JOIN public.groups g ON g.id = s.group_id
  WHERE s.id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Linked child record is unavailable.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'date', a.date,
        'status', a.status,
        'check_in_time', CASE
          WHEN a.check_in_time IS NULL THEN NULL
          ELSE to_char(a.check_in_time, 'HH24:MI')
        END
      )
      ORDER BY a.date DESC, a.created_at DESC, a.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_attendance
  FROM public.attendance a
  WHERE a.student_id = v_student.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', gr.id,
        'assessment_title', gr.assessment_title,
        'grade_type', gr.grade_type,
        'score', gr.score,
        'max_score', gr.max_score,
        'assessment_date', gr.assessment_date
      )
      ORDER BY gr.assessment_date DESC, gr.created_at DESC, gr.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_grades
  FROM public.grades gr
  WHERE gr.student_id = v_student.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', tn.id,
        'author_name', t.full_name,
        'feedback_text', tn.feedback_text,
        'note_date', to_char(tn.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
        'created_at', to_char(tn.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
      ORDER BY tn.created_at DESC, tn.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_notes
  FROM public.teacher_notes tn
  JOIN public.teachers t ON t.id = tn.teacher_id
  WHERE tn.student_id = v_student.id
    AND tn.is_parent_visible IS TRUE;

  RETURN jsonb_build_object(
    'child', jsonb_build_object(
      'id', v_student.id,
      'full_name', v_student.full_name,
      'student_code', v_student.student_code,
      'grade_level', v_student.grade_level,
      'status', v_student.status,
      'group', CASE
        WHEN v_student.group_id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', v_student.group_id,
          'name', v_student.group_name,
          'grade_level', v_student.group_grade_level
        )
      END
    ),
    'attendance', v_attendance,
    'grades', v_grades,
    'notes', v_notes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_parent_portal_children() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_portal_children() TO authenticated;

REVOKE ALL ON FUNCTION public.get_parent_child_details(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_parent_child_details(UUID) TO authenticated;
