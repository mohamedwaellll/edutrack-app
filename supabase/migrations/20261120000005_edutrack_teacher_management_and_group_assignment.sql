-- =========================================================================
-- EduTrack Milestone 5 Migration (2026-11-20)
-- Teacher Directory Management & Group Assignment
--
-- Features:
-- 1. Enforces case-insensitive teacher email uniqueness at database layer.
--    - Reports existing duplicate email conflicts without deleting or merging data.
-- 2. Validates teacher record inputs (trimmed, non-empty, valid email format).
-- 3. Grants minimal necessary privileges on public.teachers and public.groups
--    for authenticated administrators (SELECT, INSERT, REFERENCES, UPDATE).
-- 4. Strictly revokes modification privileges from anon and public.
-- 5. Preserves existing RLS policies enforcing public.is_admin() for mutations.
-- =========================================================================

-- 1. Case-Insensitive Email Uniqueness Guard on public.teachers
DO $$
DECLARE
  v_conflict_count INT;
BEGIN
  -- Check for existing case-insensitive duplicate emails
  SELECT count(*) INTO v_conflict_count
  FROM (
    SELECT lower(trim(email))
    FROM public.teachers
    GROUP BY lower(trim(email))
    HAVING count(*) > 1
  ) duplicates;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce case-insensitive unique email index on public.teachers: % duplicate email cluster(s) detected. Resolve duplicates manually before applying migration.', v_conflict_count;
  END IF;

  -- Create unique functional index for lower(trim(email))
  CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_email_lower 
  ON public.teachers (lower(trim(email)));
END $$;

-- 2. Teacher Record Validation Trigger
CREATE OR REPLACE FUNCTION public.validate_teacher_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Trim inputs
  NEW.full_name := trim(COALESCE(NEW.full_name, ''));
  NEW.subject := trim(COALESCE(NEW.subject, ''));
  NEW.email := lower(trim(COALESCE(NEW.email, '')));

  IF NEW.phone IS NOT NULL THEN
    NEW.phone := trim(NEW.phone);
    IF NEW.phone = '' THEN
      NEW.phone := NULL;
    END IF;
  END IF;

  -- Validate required values
  IF length(NEW.full_name) < 2 THEN
    RAISE EXCEPTION 'Teacher full name is required and must be at least 2 characters.';
  END IF;

  IF length(NEW.subject) < 1 THEN
    RAISE EXCEPTION 'Teacher subject is required.';
  END IF;

  IF NEW.email NOT LIKE '%_@__%.__%' THEN
    RAISE EXCEPTION 'Invalid email address format: %', NEW.email;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_teacher_record ON public.teachers;
CREATE TRIGGER tr_validate_teacher_record
BEFORE INSERT OR UPDATE ON public.teachers
FOR EACH ROW
EXECUTE FUNCTION public.validate_teacher_record();

-- 3. RLS Policies on public.teachers & public.groups (Admins Only)
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to teachers" ON public.teachers;
CREATE POLICY "Admins have full access to teachers"
ON public.teachers FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins have full access to groups" ON public.groups;
CREATE POLICY "Admins have full access to groups"
ON public.groups FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 4. Granted Privileges (Production-like minimal grants)
-- authenticated needs:
-- - teachers: SELECT, INSERT (for teacher creation), REFERENCES (for foreign key verification in groups)
-- - groups: SELECT, INSERT (for group creation), UPDATE (for group assignment)
GRANT SELECT, INSERT, REFERENCES ON public.teachers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.groups TO authenticated;

-- Revoke mutation privileges from anon & public
REVOKE INSERT, UPDATE, DELETE ON public.teachers FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.groups FROM anon, PUBLIC;
