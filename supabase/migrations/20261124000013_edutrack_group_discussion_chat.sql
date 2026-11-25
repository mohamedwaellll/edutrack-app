-- =========================================================================
-- EduTrack Group Discussion Chat Migration (2026-11-24)
--
-- Minimal group discussion chat for assigned teachers and active students
-- in their current group.
--
-- Security & Privacy Guarantees:
-- 1. Caller identity, verified role, display name, and group eligibility are
--    derived strictly server-side from auth.uid() inside SECURITY DEFINER RPCs.
-- 2. Only assigned teachers (groups.teacher_id -> teachers.user_id) and
--    active students (students.status = 'active' AND students.group_id)
--    can read or send messages for that group. Parents, admins, anon,
--    unlinked users, suspended/graduated students, and cross-group members
--    are denied fail-closed.
-- 3. Author auth.uid() (sender_user_id) is stored privately and NEVER
--    returned by RPCs (display name and verified role only).
-- 4. Direct table mutations on group_chat_messages and group_chat_markers
--    are revoked from PUBLIC, anon, and authenticated.
-- 5. Realtime marker table (public.group_chat_markers) stores ONLY group_id
--    and revision_at (no message content, no account IDs), protected by RLS
--    so unauthorized subscriptions are rejected.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.group_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGSERIAL NOT NULL,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('teacher', 'student')),
  sender_display_name TEXT NOT NULL CHECK (char_length(btrim(sender_display_name)) > 0),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_group_chat_messages_group_recent
  ON public.group_chat_messages (group_id, created_at DESC, seq DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.group_chat_markers (
  group_id UUID PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
  revision_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.group_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_chat_markers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.group_chat_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.group_chat_markers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.group_chat_markers TO authenticated;

CREATE OR REPLACE FUNCTION public.is_group_chat_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_role public.user_role;
BEGIN
  IF p_group_id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_role = 'teacher' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.teachers t
      JOIN public.groups g ON g.teacher_id = t.id
      WHERE t.user_id = v_uid
        AND g.id = p_group_id
    );
  END IF;

  IF v_role = 'student' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.user_id = v_uid
        AND s.group_id = p_group_id
        AND s.status = 'active'
    );
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.is_group_chat_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_group_chat_member(UUID) TO authenticated;

DROP POLICY IF EXISTS group_chat_markers_select_member ON public.group_chat_markers;
CREATE POLICY group_chat_markers_select_member
  ON public.group_chat_markers
  FOR SELECT
  TO authenticated
  USING (public.is_group_chat_member(group_id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'group_chat_markers'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.group_chat_markers;
    END IF;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.get_group_chat_messages(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_messages JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'Group ID is required.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_group_chat_member(p_group_id) THEN
    RAISE EXCEPTION 'Access denied: Only the assigned teacher or active students in this group may read group chat.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sub.id,
        'group_id', sub.group_id,
        'sender_display_name', sub.sender_display_name,
        'sender_role', sub.sender_role,
        'body', sub.body,
        'created_at', sub.created_at
      )
      ORDER BY sub.created_at ASC, sub.seq ASC, sub.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_messages
  FROM (
    SELECT
      m.id,
      m.seq,
      m.group_id,
      m.sender_display_name,
      m.sender_role,
      m.body,
      m.created_at
    FROM public.group_chat_messages m
    WHERE m.group_id = p_group_id
    ORDER BY m.created_at DESC, m.seq DESC, m.id DESC
    LIMIT 50
  ) sub;

  RETURN jsonb_build_object(
    'group_id', p_group_id,
    'messages', v_messages
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.send_group_chat_message(
  p_group_id UUID,
  p_body TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid UUID;
  v_profile_role public.user_role;
  v_display_name TEXT;
  v_teacher_id UUID;
  v_sender_role TEXT;
  v_body TEXT;
  v_inserted RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'Group ID is required.' USING ERRCODE = '22023';
  END IF;

  v_body := regexp_replace(COALESCE(p_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  IF char_length(v_body) < 1 THEN
    RAISE EXCEPTION 'Message cannot be empty.' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'Message exceeds maximum length of 1000 characters.' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_profile_role
  FROM public.profiles
  WHERE id = v_uid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: Verified account profile required.' USING ERRCODE = '42501';
  END IF;

  IF v_profile_role = 'teacher' THEN
    SELECT t.id, t.full_name
    INTO v_teacher_id, v_display_name
    FROM public.teachers t
    WHERE t.user_id = v_uid
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Access denied: A linked teacher record is required.' USING ERRCODE = '42501';
    END IF;

    PERFORM 1
    FROM public.groups
    WHERE id = p_group_id AND teacher_id = v_teacher_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Access denied: Group is not assigned to the authenticated teacher.' USING ERRCODE = '42501';
    END IF;

    v_sender_role := 'teacher';
  ELSIF v_profile_role = 'student' THEN
    SELECT s.full_name
    INTO v_display_name
    FROM public.students s
    WHERE s.user_id = v_uid
      AND s.group_id = p_group_id
      AND s.status = 'active'
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Access denied: Only active students currently in this group may send messages.' USING ERRCODE = '42501';
    END IF;

    v_sender_role := 'student';
  ELSE
    RAISE EXCEPTION 'Access denied: Only assigned teachers and active students may participate in group chat.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.group_chat_messages (
    group_id,
    sender_user_id,
    sender_role,
    sender_display_name,
    body
  )
  VALUES (
    p_group_id,
    v_uid,
    v_sender_role,
    v_display_name,
    v_body
  )
  RETURNING id, group_id, sender_display_name, sender_role, body, created_at
  INTO v_inserted;

  INSERT INTO public.group_chat_markers (group_id, revision_at)
  VALUES (p_group_id, NOW())
  ON CONFLICT (group_id) DO UPDATE
    SET revision_at = EXCLUDED.revision_at;

  RETURN jsonb_build_object(
    'id', v_inserted.id,
    'group_id', v_inserted.group_id,
    'sender_display_name', v_inserted.sender_display_name,
    'sender_role', v_inserted.sender_role,
    'body', v_inserted.body,
    'created_at', v_inserted.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_chat_messages(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_chat_messages(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.send_group_chat_message(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_group_chat_message(UUID, TEXT) TO authenticated;
