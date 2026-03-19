-- Extend the notifications type check constraint to include social notification types.
-- The original migration only allowed 'draw_open' and 'points_awarded'.
-- New types added: challenge_received, friend_request, friend_accepted, friend_picks_locked

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'draw_open',
    'points_awarded',
    'challenge_received',
    'friend_request',
    'friend_accepted',
    'friend_picks_locked'
  ));
