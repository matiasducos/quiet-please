-- 043_achievements.sql
-- Achievement / rewards system: user_achievements table, indexes, RLS,
-- notification type, and tournament ranking helper function.

-- ── Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_achievements (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_key text        NOT NULL,
  tournament_id   uuid        REFERENCES public.tournaments(id) ON DELETE SET NULL,
  meta            jsonb       NOT NULL DEFAULT '{}',
  earned_at       timestamptz NOT NULL DEFAULT now()
);

-- Tournament-specific achievements (trophies): one per user per key per tournament
ALTER TABLE public.user_achievements
  ADD CONSTRAINT uq_user_achievement_tournament
  UNIQUE (user_id, achievement_key, tournament_id);

-- Generic achievements (non-tournament): one per user per key
CREATE UNIQUE INDEX uq_user_achievement_generic
  ON public.user_achievements (user_id, achievement_key)
  WHERE tournament_id IS NULL;

-- ── Indexes ──────────────────────────────────────────────────────
CREATE INDEX idx_user_achievements_user_earned
  ON public.user_achievements (user_id, earned_at DESC);

CREATE INDEX idx_user_achievements_key
  ON public.user_achievements (achievement_key);

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

-- Achievements are publicly readable (visible on any user's profile)
CREATE POLICY "Achievements are publicly readable"
  ON public.user_achievements FOR SELECT
  USING (true);

-- Only service role (admin client) can insert/update/delete
-- No INSERT/UPDATE/DELETE policies for authenticated role

-- ── Notification type ────────────────────────────────────────────
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
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
    'league_ownership_transferred',
    'auto_predictions_generated',
    'achievement_earned'
  ));

-- ── Tournament ranking function (DENSE_RANK for ties) ────────────
CREATE OR REPLACE FUNCTION public.get_tournament_rankings(p_tournament_id uuid)
RETURNS TABLE(user_id uuid, points_earned integer, rank bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    p.user_id,
    p.points_earned::integer,
    DENSE_RANK() OVER (ORDER BY p.points_earned DESC)::bigint AS rank
  FROM public.predictions p
  WHERE p.tournament_id = p_tournament_id
    AND p.challenge_id IS NULL
    AND p.points_earned > 0
  ORDER BY rank
  LIMIT 50;
$$;
