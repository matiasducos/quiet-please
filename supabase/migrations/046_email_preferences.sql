-- Add granular email notification preferences (JSONB)
-- The existing email_notifications boolean is kept as a master kill switch
-- (used by one-click unsubscribe). Individual prefs are checked per email type.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_preferences jsonb NOT NULL DEFAULT '{
    "draw_open": true,
    "points_awarded": true,
    "friend_request": true,
    "friend_accepted": true,
    "challenge_received": true,
    "auto_predictions": true,
    "achievement_earned": true
  }'::jsonb;
