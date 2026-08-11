-- Migration: 080_points_expired_notification
-- Description: Adds the 'points_expired' notification type.
--
-- When the daily expire-points sweep (079) drops a user's points, they are told
-- in-app. Deliberately NOT by email: a dormant user is exactly the person who
-- would read "your points expired" in their inbox as a reason to stay gone.
--
-- Postgres has no ADD VALUE for a CHECK ... IN, so the full list has to be
-- re-declared. Copied forward from 052_invite_feature.sql — if you add a type,
-- copy this whole list again rather than writing a partial one.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'draw_open',
    'points_awarded',
    'points_expired',
    'challenge_received',
    'challenge_cancelled',
    'challenge_picks_locked',
    'friend_request',
    'friend_accepted',
    'friend_picks_locked',
    'league_member_joined',
    'league_member_left',
    'league_deleted',
    'league_ownership_transferred',
    'auto_predictions_generated',
    'achievement_earned',
    'referral_joined'
  ));
