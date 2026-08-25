-- Migration: 091_unread_count_rpc
-- Description: Let the browser read its own unread-message count straight from
--              Postgres, so the nav badge stops invoking a Vercel function.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHY THIS IS NOT A REALTIME MIGRATION
--
-- The first version pushed the count over Realtime broadcast. It cannot be
-- installed on this project: private channels are authorized by RLS policies on
-- `realtime.messages`, that table is owned by `supabase_realtime_admin`, and the
-- dashboard runs as `postgres`, which is not a member of that role:
--
--   owner = supabase_realtime_admin, running_as = postgres,
--   pg_has_role(...) = false  ->  "42501: must be owner of table messages"
--
-- Granting postgres that membership would widen privileges well past this
-- feature, and a public channel would turn the topic name into a bearer token.
--
-- Neither is necessary, because the problem was narrower than "polling". The
-- badge polled /api/messages/unread-count — a VERCEL function — every ten
-- seconds, from the nav, on every page. One signed-in user with a tab open for
-- an hour was 360 serverless invocations, and the cost scaled with concurrent
-- users rather than with anything a user actually did.
--
-- A request the browser sends straight to Supabase never touches a Fluid
-- function, so it costs zero Active CPU however often it fires. Repointing the
-- call is the whole fix: the interval was never the bug, its destination was.
-- ============================================================


-- ── Unread count for one user ────────────────────────────────────────────────
-- Counts messages addressed TO this user that they have not read, across every
-- conversation they belong to.
--
-- `m.sender_id <> p_user_id` is safe here specifically because sender_id is NOT
-- NULL. `<>` silently drops NULL rows, which is how the previous version of this
-- count — a PostgREST `.neq()` — was quietly wrong.
CREATE OR REPLACE FUNCTION public.unread_message_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE m.read_at IS NULL
    AND m.sender_id <> p_user_id
    AND (c.user1_id = p_user_id OR c.user2_id = p_user_id);
$$;

COMMENT ON FUNCTION public.unread_message_count(UUID) IS
  'Total unread messages addressed to a user. Server-side helper; clients call my_unread_message_count().';

-- The existing idx_messages_unread is (conversation_id, sender_id)
-- WHERE read_at IS NULL, which is right for "unread in THIS conversation" but
-- makes the per-user rollup walk every conversation the user belongs to.
CREATE INDEX IF NOT EXISTS idx_messages_unread_by_sender
  ON public.messages (sender_id, conversation_id)
  WHERE read_at IS NULL;


-- ── What clients may call ────────────────────────────────────────────────────
-- unread_message_count(uuid) is SECURITY DEFINER and takes the user as an
-- argument, so granting it to `authenticated` would let any signed-in user read
-- any other user's unread count by passing their id. It stays server-side only.
--
-- The browser calls the zero-argument wrapper, which derives the user from the
-- session. There is no id to tamper with, so the badge can be read straight from
-- the client with no Vercel round trip and no new attack surface.
REVOKE EXECUTE ON FUNCTION public.unread_message_count(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.unread_message_count(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.my_unread_message_count()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.unread_message_count(auth.uid()), 0)
  WHERE auth.uid() IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.my_unread_message_count() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_unread_message_count() TO authenticated, service_role;
