-- Migration: 106_league_chat_unread
-- Description: Per-member read marker for league group chat, plus the two RPCs
--              the unread dots read and write.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHY A COLUMN ON league_members AND NOT messages.read_at
--
-- Direct messages (041) track read state per MESSAGE: messages.read_at, set
-- when the one recipient opens the thread. That works because a DM has exactly
-- one reader. A league chat has as many readers as the league has members, so
-- per-message read state would need a league_message_reads join table — one row
-- per message per member, which is members x messages rows to write and to
-- garbage-collect, for a feature whose entire output is a red dot.
--
-- A single high-water mark per membership answers the same question in one
-- column: everything after chat_read_at is unread. It cannot express "read the
-- last one but not the one before", which is a distinction no dot renders.
--
-- NULL means never opened. Unread is then measured from joined_at rather than
-- from the beginning of time, so joining a league with 400 messages of history
-- does not greet the new member with a dot they can never explain.
-- ============================================================

ALTER TABLE public.league_members
  ADD COLUMN IF NOT EXISTS chat_read_at TIMESTAMPTZ;

COMMENT ON COLUMN public.league_members.chat_read_at IS
  'High-water mark: when this member last had the league chat open. NULL means never, and unread is then measured from joined_at so a new member does not inherit the backlog.';


-- ── Which of my leagues have something new ───────────────────────────────────
-- Returns the league ids the caller has unread messages in. One call answers
-- all three dots: the nav dot is "is this array non-empty", the leagues list
-- asks "does it contain this row", and the chat tab asks "does it contain this
-- league".
--
-- EXISTS, not COUNT. The dots are booleans, and a count would read every
-- message after the marker to produce a number nothing renders. EXISTS stops at
-- the first row, which on idx_league_messages_league_created (048) is the
-- newest message in the league — usually the first tuple it touches.
--
-- `m.sender_id <> lm.user_id` is safe here specifically because 048 declares
-- sender_id NOT NULL. `<>` drops NULL rows silently, which is the exact shape
-- of the bug 091 documents in the DM count it replaced.
--
-- Ordered inside array_agg so the same set always serialises identically. The
-- browser diffs this array against the one it is holding to decide whether to
-- re-render; an unordered agg would shuffle and make every poll look like a
-- change.
CREATE OR REPLACE FUNCTION public.my_unread_league_ids()
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(lm.league_id ORDER BY lm.league_id), '{}'::uuid[])
  FROM public.league_members lm
  WHERE lm.user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.league_messages m
      WHERE m.league_id  = lm.league_id
        AND m.sender_id <> lm.user_id
        AND m.created_at > COALESCE(lm.chat_read_at, lm.joined_at)
    );
$$;

COMMENT ON FUNCTION public.my_unread_league_ids() IS
  'League ids the calling user has unread chat messages in. Derives the user from auth.uid(), so it is safe to call straight from the browser.';

-- Callable from the browser, like my_unread_message_count(). There is no id
-- argument to tamper with: the function reads auth.uid() itself, so a signed-in
-- user can only ever learn about their own memberships.
REVOKE EXECUTE ON FUNCTION public.my_unread_league_ids() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_unread_league_ids() TO authenticated, service_role;


-- ── Marking a league chat read ───────────────────────────────────────────────
-- SECURITY DEFINER rather than an UPDATE policy on league_members, and that is
-- a deliberate narrowing, not a shortcut around RLS.
--
-- RLS gates ROWS, not columns. A policy of `USING (user_id = auth.uid())` would
-- let any member PATCH their own membership row directly — including
-- total_points, which IS the league standings. The whole leaderboard would
-- become client-writable to buy one timestamp.
--
-- This function writes exactly one column on exactly one row, and picks the row
-- from auth.uid() rather than from anything the caller sends. p_league_id can
-- only ever narrow the update to a league; it cannot redirect it to someone
-- else's membership.
CREATE OR REPLACE FUNCTION public.mark_league_chat_read(p_league_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.league_members
     SET chat_read_at = now()
   WHERE league_id = p_league_id
     AND user_id   = auth.uid()
  RETURNING chat_read_at;
$$;

COMMENT ON FUNCTION public.mark_league_chat_read(UUID) IS
  'Moves the caller''s read marker on one league chat to now(). Writes only chat_read_at, only on the caller''s own membership row.';

REVOKE EXECUTE ON FUNCTION public.mark_league_chat_read(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_league_chat_read(UUID) TO authenticated, service_role;


-- ── Index ────────────────────────────────────────────────────────────────────
-- The unread probe is (league_id, created_at > cutoff) with a sender filter.
-- idx_league_messages_league_created (048) is already (league_id, created_at
-- DESC), which is the right leading pair — the scan starts at the newest
-- message and stops on the first one from someone else. No new index needed.
--
-- The outer driver is league_members(user_id), served by idx_league_members_user_id
-- (001). Also already present.
