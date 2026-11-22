-- =========================================================================
-- EduTrack Stage D Migration (2026-11-21)
-- Scoped Read-Only Student Portal RPC (Profile Card, Attendance & Grades)
--
-- Migration Order & Precedence:
-- 1. Must run strictly AFTER:
--    20261121000006_edutrack_stage_c2_teacher_grade_and_note_writes.sql
--
-- Security, Privacy & Data Scope Guarantees:
-- 1. Student identity is ALWAYS derived server-side from:
--      auth.uid() -> public.profiles (role = 'student') -> public.students.user_id
--    No student_id parameter is accepted from the client.
-- 2. Unlinked student accounts return { linked: false } cleanly, distinct from
--    unauthorized callers or database/network read errors.
-- 3. Student card exposes ONLY id, full_name, student_code, grade_level,
--    status, and current group summary (id, name, grade_level) if assigned.
-- 4. Attendance returns ONLY the student's own recorded entries (date DESC).
-- 5. Grades return ALL of the student's own saved grades (assessment_date DESC),
--    preserving historical scores even if student group or group teacher changed.
-- 6. Strictly OMITS qr_code_hash, parent_name, parent_phone, user_id,
--    teacher_id, remarks, and all teacher_notes (internal & parent notes).
-- 7. Direct table RLS policies remain unchanged (admin-only), preserving
--    existing Admin and Stage C Teacher workflows.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_student_portal_data()
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
  WHERE s.user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'linked', FALSE,
      'student', NULL,
      'attendance', '[]'::jsonb,
      'grades', '[]'::jsonb
    );
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

  RETURN jsonb_build_object(
    'linked', TRUE,
    'student', jsonb_build_object(
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
    'grades', v_grades
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_portal_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_portal_data() TO authenticated;
