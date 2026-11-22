-- =========================================================================
-- EduTrack Milestone 5.1 Migration (2026-11-21)
-- Teacher Management Corrections, Integrity & Column Privilege Hardening
--
-- Migration Order & Precedence:
-- 1. Must run strictly AFTER:
--    20261120000005_edutrack_teacher_management_and_group_assignment.sql
-- 2. Must run strictly BEFORE:
--    Future Stage B role-expansion and multi-role access migrations.
--
-- Documentation Correction:
-- - In PostgreSQL, the REFERENCES privilege is only required when declaring
--   or altering a foreign-key constraint on a table. It is NOT required for
--   ordinary DML (inserting or updating rows in child tables that reference
--   an existing foreign key). The previous REFERENCES grant on public.teachers
--   was unnecessary and is explicitly revoked here.
--
-- Changes Applied:
-- 1. Pre-execution guard: Checks for case-insensitive duplicate teacher emails
--    and aborts without modifying, deleting, or merging existing records.
-- 2. Sanitization function hardening:
--    - Removes unnecessary SECURITY DEFINER from pure sanitization function.
--    - Enforces allowed teacher creation fields in PostgreSQL by rejecting
--      direct user_id assignment on INSERT. Future trusted account linking
--      remains supported via dedicated routines.
--    - Trims inputs, converts empty phone to NULL.
--    - Aligns email regex with client validation: accepts valid short domains
--      like 'a@b.co', while rejecting internal spaces, multiple @, and missing TLDs.
-- 3. Group permission hardening:
--    - Revokes broad table-level UPDATE on public.groups from authenticated.
--    - Grants narrow column-level UPDATE (teacher_id, updated_at) on public.groups
--      to authenticated, preventing modification of group name, grade, or capacity.
--    - Revokes unnecessary REFERENCES on public.teachers from authenticated.
--    - Enforces fail-closed RLS using public.is_admin().
-- =========================================================================

-- 1. Pre-execution Data Integrity Check
DO $$
DECLARE
  v_conflict_count INT;
BEGIN
  SELECT count(*) INTO v_conflict_count
  FROM (
    SELECT lower(trim(email))
    FROM public.teachers
    GROUP BY lower(trim(email))
    HAVING count(*) > 1
  ) duplicates;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration 20261121000001: % duplicate teacher email cluster(s) detected in public.teachers. Resolve duplicates manually before applying.', v_conflict_count;
  END IF;
END $$;

-- Ensure functional unique index exists idempotently
CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_email_lower
ON public.teachers (lower(trim(email)));

-- 2. Hardened Teacher Record Validation Trigger (Pure Function, No SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.validate_teacher_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Database enforcement: reject direct user_id assignment on creation
  IF TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Direct user_id assignment is prohibited during teacher creation. Account linking is managed separately.';
  END IF;

  -- Trim inputs and enforce lower-case trimmed email
  NEW.full_name := trim(COALESCE(NEW.full_name, ''));
  NEW.subject := trim(COALESCE(NEW.subject, ''));
  NEW.email := lower(trim(COALESCE(NEW.email, '')));

  -- Phone sanitization: empty string becomes NULL
  IF NEW.phone IS NOT NULL THEN
    NEW.phone := trim(NEW.phone);
    IF NEW.phone = '' THEN
      NEW.phone := NULL;
    END IF;
  END IF;

  -- Validate required fields
  IF length(NEW.full_name) < 2 THEN
    RAISE EXCEPTION 'Teacher full name is required and must be at least 2 characters.';
  END IF;

  IF length(NEW.subject) < 1 THEN
    RAISE EXCEPTION 'Teacher subject is required.';
  END IF;

  -- Standard RFC-aligned email validation matching client regex
  -- Accepts a@b.co; rejects internal spaces, multiple @, and missing TLD
  IF NEW.email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
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

-- 3. Permission Hardening: Revoke Broad Grants & Enforce Column-Level Privileges

-- A. Revoke unnecessary REFERENCES on public.teachers
REVOKE REFERENCES ON public.teachers FROM authenticated;
REVOKE REFERENCES ON public.teachers FROM anon, PUBLIC;

-- B. Revoke broad table-level UPDATE on public.groups
REVOKE UPDATE ON public.groups FROM authenticated;
REVOKE UPDATE ON public.groups FROM anon, PUBLIC;

-- C. Grant narrow column-level UPDATE on public.groups for assignment workflows
GRANT UPDATE (teacher_id, updated_at) ON public.groups TO authenticated;

-- D. Re-affirm minimal table-level permissions
GRANT SELECT, INSERT ON public.teachers TO authenticated;
GRANT SELECT, INSERT ON public.groups TO authenticated;

-- E. Strictly revoke mutations from anon and PUBLIC
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.teachers FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.groups FROM anon, PUBLIC;

-- F. Re-affirm RLS policies on public.teachers and public.groups
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
