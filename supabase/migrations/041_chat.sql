-- Migration: 041_chat
-- Description: Friend-to-friend chat — conversations and messages tables
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- CONVERSATIONS
-- One row per 1:1 chat thread between two users.
-- user1_id < user2_id enforced to prevent duplicate pairs.
-- ============================================================

CREATE TABLE public.conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user2_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conversations_ordered_pair CHECK (user1_id < user2_id),
  CONSTRAINT conversations_unique_pair  UNIQUE (user1_id, user2_id),
  CONSTRAINT conversations_no_self      CHECK (user1_id <> user2_id)
);

-- "My conversations sorted by latest message" — need index for both positions
CREATE INDEX idx_conversations_user1_last
  ON public.conversations (user1_id, last_message_at DESC);
CREATE INDEX idx_conversations_user2_last
  ON public.conversations (user2_id, last_message_at DESC);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Users can see conversations they are part of
CREATE POLICY "conversations_select"
  ON public.conversations FOR SELECT
  USING (auth.uid() = user1_id OR auth.uid() = user2_id);

-- Users can create conversations they are part of
CREATE POLICY "conversations_insert"
  ON public.conversations FOR INSERT
  WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);

-- No UPDATE/DELETE policies:
-- last_message_at is bumped via admin client in the send-message API route

-- ============================================================
-- MESSAGES
-- Individual messages within a conversation.
-- ============================================================

CREATE TABLE public.messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body            TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary query: paginate messages in a conversation (newest first)
CREATE INDEX idx_messages_conversation_created
  ON public.messages (conversation_id, created_at DESC);

-- Unread count: messages not yet read, excluding own (for badge counts)
CREATE INDEX idx_messages_unread
  ON public.messages (conversation_id, sender_id)
  WHERE read_at IS NULL;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Users can read messages in conversations they belong to
CREATE POLICY "messages_select"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
    )
  );

-- Users can send messages in conversations they belong to (as themselves)
CREATE POLICY "messages_insert"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
    )
  );

-- Users can mark received messages as read (not their own)
CREATE POLICY "messages_update_read"
  ON public.messages FOR UPDATE
  USING (
    sender_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
    )
  );
