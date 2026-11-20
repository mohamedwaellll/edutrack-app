-- Milestone 4: live admin-managed grades and teacher notes.
-- Validate new writes without deleting or rewriting historical records.
BEGIN;

ALTER TABLE public.grades
  ALTER COLUMN assessment_date SET DEFAULT ((NOW() AT TIME ZONE 'Africa/Cairo')::DATE);

CREATE OR REPLACE FUNCTION public.validate_grade_record()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  student_group UUID;
  student_status TEXT;
BEGIN
  IF NEW.assessment_title IS NULL OR btrim(NEW.assessment_title) = '' THEN
    RAISE EXCEPTION 'Assessment title is required';
  END IF;
  IF NEW.score IS NULL OR NEW.max_score IS NULL OR NOT (
    NEW.max_score > 0 AND NEW.max_score < 1000 AND NEW.score >= 0 AND NEW.score <= NEW.max_score
  ) THEN
    RAISE EXCEPTION 'Invalid score: expected 0 <= score <= maximum, with 0 < maximum < 1000';
  END IF;
  IF NEW.assessment_date IS NULL OR NEW.assessment_date > (NOW() AT TIME ZONE 'Africa/Cairo')::DATE THEN
    RAISE EXCEPTION 'Assessment date must not be in the future';
  END IF;
  -- Lock the student until the write completes, preventing concurrent reassignment.
  SELECT group_id, status INTO student_group, student_status
    FROM public.students WHERE id = NEW.student_id FOR SHARE;
  IF NOT FOUND OR student_group IS NULL OR NEW.group_id IS DISTINCT FROM student_group THEN
    RAISE EXCEPTION 'Student must belong to the selected group';
  END IF;
  IF student_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Only active students can receive new assessments';
  END IF;
  NEW.assessment_title := btrim(NEW.assessment_title);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_grade_record ON public.grades;
CREATE TRIGGER tr_validate_grade_record BEFORE INSERT OR UPDATE ON public.grades
  FOR EACH ROW EXECUTE FUNCTION public.validate_grade_record();

CREATE OR REPLACE FUNCTION public.validate_teacher_note()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  student_group UUID;
  student_status TEXT;
BEGIN
  IF NEW.feedback_text IS NULL OR btrim(NEW.feedback_text) = '' THEN
    RAISE EXCEPTION 'Feedback text is required';
  END IF;
  IF NEW.is_parent_visible IS NULL THEN
    RAISE EXCEPTION 'Feedback visibility is required';
  END IF;
  SELECT group_id, status INTO student_group, student_status
    FROM public.students WHERE id = NEW.student_id FOR SHARE;
  IF NOT FOUND OR student_group IS NULL OR student_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Feedback requires an active student assigned to a group';
  END IF;
  -- teacher_id is an explicitly selected author, validated by the existing FK.
  NEW.feedback_text := btrim(NEW.feedback_text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_teacher_note ON public.teacher_notes;
CREATE TRIGGER tr_validate_teacher_note BEFORE INSERT OR UPDATE ON public.teacher_notes
  FOR EACH ROW EXECUTE FUNCTION public.validate_teacher_note();

-- Existing admin-only RLS stays in force. No teacher/parent access is introduced.
GRANT SELECT, INSERT, UPDATE ON public.grades, public.teacher_notes TO authenticated;
REVOKE ALL ON FUNCTION public.validate_grade_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_teacher_note() FROM PUBLIC, anon, authenticated;

COMMIT;
