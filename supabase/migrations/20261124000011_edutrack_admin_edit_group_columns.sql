-- =========================================================================
-- EduTrack Admin Class Group Editing Column Privileges (2026-11-24)
--
-- Grants narrow column-level UPDATE privileges on public.groups so admins
-- can edit class metadata (name, grade_level, subject, room, capacity,
-- schedule, updated_at) while preserving column-level protection on
-- id, enrolled_count, and created_at.
--
-- Existing admin-only RLS policy ("Admins have full access to groups")
-- remains enforced via public.is_admin(), and anon/PUBLIC remain revoked.
-- =========================================================================

GRANT UPDATE (name, grade_level, subject, room, capacity, schedule, updated_at)
ON public.groups
TO authenticated;
