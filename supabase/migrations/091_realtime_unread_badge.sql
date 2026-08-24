-- Migration: 091_realtime_unread_badge
-- Description: Push the unread-message badge over Realtime instead of polling
--              /api/messages/unread-count every 10 seconds.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHY BROADCAST AND NOT `postgres_changes`
--
-- The obvious way to do this is a `postgres_changes` subscription on
-- public.messages with RLS doing the filtering. That does not scale here and
-- would trade one growth problem for another.
--
-- `postgres_changes` evaluates every subscriber's RLS policy against every
-- change: one INSERT with N connected clients costs N policy evaluations, and
-- messages_select is a subquery against conversations, so each of those is a
-- join. That is O(connected users) of database work per message sent — the same
-- shape of curve as the polling it replaces, just moved to Postgres.
--
-- Broadcast is O(1) per message. A trigger computes exactly who should hear
-- about the change and sends to their private topic. Two participants, two
-- sends, regardless of how many people are online. Supabase's own guidance is
-- to prefer Broadcast over postgres_changes at scale, and with a 10k-user
-- target that is the only defensible choice.
--
-- The payload carries the recomputed count rather than the message row. The
-- client then never has to ask anything: no refetch, no API route, no Vercel
-- invocation. That is the entire point — the badge must cost zero Active CPU.
-- ============================================================


-- ── Unread count for one user ────────────────────────────────────────────────
-- Extracted as a function because three places need exactly this number and
-- they must not drift: the trigger below, the initial server render, and any
-- future backfill. Counts messages addressed TO this user that they have not
-- read, across every conversation they belong to.
--
-- Note `m.sender_id <> p_user_id` rather than a NULL-tolerant comparison:
-- sender_id is NOT NULL, so this cannot silently drop rows the way <> does on
-- a nullable column.
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
  'Total unread messages addressed to a user. Used by the Realtime badge trigger and the initial server render.';

-- Supporting index. The existing idx_messages_unread is
-- (conversation_id, sender_id) WHERE read_at IS NULL, which is right for
-- "unread in THIS conversation" but makes the per-user rollup walk every
-- conversation the user is in. This one lets the planner go straight from
-- sender to unread rows.
CREATE INDEX IF NOT EXISTS idx_messages_unread_by_sender
  ON public.messages (sender_id, conversation_id)
  WHERE read_at IS NULL;


-- ── Broadcast the recomputed badge to one user's private topic ───────────────
CREATE OR REPLACE FUNCTION public.broadcast_unread_count(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'count', public.unread_message_count(p_user_id),
      'at',    extract(epoch FROM now())
    ),
    'unread',                             -- event name
    'user:' || p_user_id::text,           -- private topic, one per user
    true                                  -- private: requires authorization below
  );
END;
$$;


-- ── Trigger: recompute for whoever the change affects ────────────────────────
-- INSERT  — a new message changes the RECIPIENT's badge.
-- UPDATE  — read_at being stamped changes the READER's badge (the recipient).
--
-- Both participants are resolved from the conversation rather than assumed, so
-- this stays correct whichever side of the ordered pair the sender is on.
CREATE OR REPLACE FUNCTION public.messages_broadcast_unread()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient UUID;
  v_sender    UUID;
BEGIN
  SELECT CASE WHEN c.user1_id = NEW.sender_id THEN c.user2_id ELSE c.user1_id END,
         NEW.sender_id
    INTO v_recipient, v_sender
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_recipient IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.broadcast_unread_count(v_recipient);

  -- A second, content-free ping so the open chat views can react.
  --
  -- Deliberately carries only the conversation id, not the message body. The
  -- views need to know THAT something changed; they already have authenticated
  -- endpoints for fetching WHAT changed, and those endpoints enforce RLS. Putting
  -- the body in the broadcast would mean the Realtime authorization policy became
  -- the thing standing between a user and other people's message text, which is a
  -- much worse place for that decision to live than an RLS policy on the table
  -- itself.
  --
  -- Both sides get it: the recipient to append the incoming message, the sender
  -- so their other open tabs and devices stay in sync.
  --
  -- INSERT only. This function is shared with the read_at trigger, and marking
  -- a thread read is not new content — pinging on it would make every open chat
  -- view refetch for nothing, which is exactly the invocation the badge change
  -- exists to remove.
  IF TG_OP <> 'INSERT' THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object('conversationId', NEW.conversation_id),
    'message',
    'user:' || v_recipient::text,
    true
  );
  PERFORM realtime.send(
    jsonb_build_object('conversationId', NEW.conversation_id),
    'message',
    'user:' || v_sender::text,
    true
  );

  RETURN NULL;  -- AFTER trigger; return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_broadcast_unread_insert ON public.messages;
CREATE TRIGGER trg_messages_broadcast_unread_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_broadcast_unread();

-- Only when read_at actually transitions to non-null. Without the WHEN clause
-- every unrelated UPDATE would fire a broadcast, and marking a 50-message
-- thread read would send 50 identical badge updates.
DROP TRIGGER IF EXISTS trg_messages_broadcast_unread_read ON public.messages;
CREATE TRIGGER trg_messages_broadcast_unread_read
  AFTER UPDATE OF read_at ON public.messages
  FOR EACH ROW
  WHEN (OLD.read_at IS NULL AND NEW.read_at IS NOT NULL)
  EXECUTE FUNCTION public.messages_broadcast_unread();


-- ── Authorization for private topics ─────────────────────────────────────────
-- Realtime private channels are gated by RLS on realtime.messages. Without
-- this policy every subscribe is rejected; with it, a user may join exactly
-- one topic — their own. `realtime.topic()` is the topic the client asked for.
--
-- SELECT is the only verb granted. Clients listen; only the triggers above,
-- which run as SECURITY DEFINER, may send.
--
-- NOTE: do NOT `ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY` here.
-- That table is owned by supabase_realtime_admin, not postgres, so the dashboard
-- SQL editor cannot alter it — it fails with "42501: must be owner of table
-- messages". It is also unnecessary: Supabase ships that table with RLS already
-- enabled, which is why a private channel with no policy rejects every subscribe
-- rather than allowing them.

DROP POLICY IF EXISTS "realtime_own_user_topic_select" ON realtime.messages;
CREATE POLICY "realtime_own_user_topic_select"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING (
    realtime.topic() = 'user:' || auth.uid()::text
    AND realtime.messages.extension = 'broadcast'
  );

-- ── What clients may call ────────────────────────────────────────────────────
-- unread_message_count(uuid) is SECURITY DEFINER and takes the user as an
-- argument, so granting it to `authenticated` would let any signed-in user read
-- any other user's unread count by passing their id. It stays service_role-only
-- and is called by the triggers above, which run as definer anyway.
--
-- Clients get a zero-argument wrapper that derives the user from the session,
-- so there is no id to tamper with.
REVOKE EXECUTE ON FUNCTION public.unread_message_count(UUID) FROM PUBLIC, authenticated, anon;
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


-- ============================================================
-- LEAGUE CHAT
--
-- A group chat, so the topic is the league rather than the user. One broadcast
-- reaches every member connected to it, which is the whole reason to shape it
-- this way: per-user topics would mean N sends per message in an N-member
-- league, and leagues are the one place in this product designed to get large.
-- ============================================================

CREATE OR REPLACE FUNCTION public.league_messages_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Content-free, for the same reason as the 1:1 ping above: membership is
  -- enforced by RLS on league_messages, and that is where it should stay.
  PERFORM realtime.send(
    jsonb_build_object('leagueId', NEW.league_id),
    'message',
    'league:' || NEW.league_id::text,
    true
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_league_messages_broadcast ON public.league_messages;
CREATE TRIGGER trg_league_messages_broadcast
  AFTER INSERT ON public.league_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.league_messages_broadcast();

-- A user may listen to a league topic only if they are a member of it. This
-- mirrors league_messages_select exactly — if the two ever diverge, the RLS
-- policy on the table is the one that governs what can actually be read.
DROP POLICY IF EXISTS "realtime_league_topic_select" ON realtime.messages;
CREATE POLICY "realtime_league_topic_select"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() LIKE 'league:%'
    AND EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id::text = substring(realtime.topic() FROM 8)
        AND lm.user_id = auth.uid()
    )
  );
