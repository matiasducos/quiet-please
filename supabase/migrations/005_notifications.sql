-- Notifications table for in-app + email alerts
CREATE TABLE IF NOT EXISTS notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          text        NOT NULL CHECK (type IN ('draw_open', 'points_awarded')),
  tournament_id uuid        REFERENCES tournaments(id) ON DELETE CASCADE,
  meta          jsonb       NOT NULL DEFAULT '{}',
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup: unread notifications per user
CREATE INDEX notifications_user_unread
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

-- RLS: users can only see their own notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);
