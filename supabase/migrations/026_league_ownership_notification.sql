-- Migration: 026_league_ownership_notification
-- Adds: league_ownership_transferred notification type.

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'draw_open',
    'points_awarded',
    'challenge_received',
    'challenge_cancelled',
    'challenge_picks_locked',
    'friend_request',
    'friend_accepted',
    'friend_picks_locked',
    'league_member_joined',
    'league_member_left',
    'league_deleted',
    'league_ownership_transferred'
  ));
