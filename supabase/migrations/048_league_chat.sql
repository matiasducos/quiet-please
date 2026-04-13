-- Migration: 048_league_chat
-- Description: League group chat — messages table for league-scoped conversations
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- LEAGUE MESSAGES
-- One table for all league group chats.
-- league_id acts as the conversation identifier.
-- ============================================================

CREATE TABLE public.league_messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID        NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  sender_id  UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body       TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary query: paginate messages in a league chat (newest first)
CREATE INDEX idx_league_messages_league_created
  ON public.league_messages (league_id, created_at DESC);

ALTER TABLE public.league_messages ENABLE ROW LEVEL SECURITY;

-- Members can read messages in leagues they belong to
CREATE POLICY "league_messages_select"
  ON public.league_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_messages.league_id
        AND lm.user_id = auth.uid()
    )
  );

-- Members can send messages in leagues they belong to (as themselves)
CREATE POLICY "league_messages_insert"
  ON public.league_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_messages.league_id
        AND lm.user_id = auth.uid()
    )
  );
