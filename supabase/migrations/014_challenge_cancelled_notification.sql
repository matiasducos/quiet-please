-- Add 'challenge_cancelled' notification type so the challenged user gets notified
-- when the challenger cancels a pending challenge.

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'draw_open',
    'points_awarded',
    'challenge_received',
    'challenge_cancelled',
    'friend_request',
    'friend_accepted',
    'friend_picks_locked'
  ));
