-- Migration: 007_ranking_system
-- Description: Rolling 52-week ranking system, weekly tournament slots, user location fields
-- Session: 15

-- ── predictions: expires_at ────────────────────────────────────────────────────
-- Points expire 364 days (52 weeks) after the tournament started.
-- Set by the award-points cron when points are first awarded.
-- When the same tournament runs next year, expires_at is updated to the new edition's start.
ALTER TABLE public.predictions
  ADD COLUMN expires_at TIMESTAMPTZ;

-- ── users: ranking columns + location ─────────────────────────────────────────
-- ranking_points     = rolling 52-week total (ATP + WTA combined)
-- atp_ranking_points = rolling 52-week total from ATP tournaments only
-- wta_ranking_points = rolling 52-week total from WTA tournaments only
-- country, city      = user location for Country / City leaderboards
ALTER TABLE public.users
  ADD COLUMN ranking_points     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN atp_ranking_points INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN wta_ranking_points INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN country            TEXT,
  ADD COLUMN city               TEXT;

-- ── weekly_slots ──────────────────────────────────────────────────────────────
-- Enforces the one-ATP-slot + one-WTA-slot-per-week rule.
-- iso_year + iso_week = ISO 8601 calendar week (week starts Monday).
-- One row per (user, circuit, year, week). Grand Slams insert TWO rows (2-week span).
-- UNIQUE constraint prevents double-booking at the DB level.
CREATE TABLE public.weekly_slots (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  circuit        TEXT        NOT NULL CHECK (circuit IN ('ATP', 'WTA')),
  iso_year       INTEGER     NOT NULL,
  iso_week       INTEGER     NOT NULL,
  tournament_id  UUID        NOT NULL REFERENCES public.tournaments(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, circuit, iso_year, iso_week)
);

ALTER TABLE public.weekly_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own weekly slots"
  ON public.weekly_slots FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own weekly slots"
  ON public.weekly_slots FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── recalculate_ranking_points RPC ────────────────────────────────────────────
-- Recomputes all three ranking point columns for a single user.
-- Reads from predictions (joined to tournaments for circuit split).
-- Only counts: locked, non-practice, positive points, not yet expired.
CREATE OR REPLACE FUNCTION public.recalculate_ranking_points(p_user_id UUID)
RETURNS VOID LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  _total INTEGER;
  _atp   INTEGER;
  _wta   INTEGER;
BEGIN
  SELECT
    COALESCE(SUM(p.points_earned), 0),
    COALESCE(SUM(CASE WHEN t.tour = 'ATP' THEN p.points_earned ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.tour = 'WTA' THEN p.points_earned ELSE 0 END), 0)
  INTO _total, _atp, _wta
  FROM public.predictions p
  JOIN public.tournaments t ON t.id = p.tournament_id
  WHERE p.user_id       = p_user_id
    AND p.is_practice   = false
    AND p.is_locked     = true
    AND p.points_earned > 0
    AND (p.expires_at IS NULL OR p.expires_at > NOW());

  UPDATE public.users
  SET ranking_points     = _total,
      atp_ranking_points = _atp,
      wta_ranking_points = _wta
  WHERE id = p_user_id;
END;
$$;

-- ── Reset all point data (all existing users are test/dummy accounts) ──────────
UPDATE public.users
SET total_points       = 0,
    ranking_points     = 0,
    atp_ranking_points = 0,
    wta_ranking_points = 0;

UPDATE public.predictions
SET points_earned = 0,
    expires_at    = NULL;

DELETE FROM public.point_ledger;

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_weekly_slots_user_circuit ON public.weekly_slots (user_id, circuit);
CREATE INDEX idx_predictions_expires_at    ON public.predictions (expires_at);
CREATE INDEX idx_users_country             ON public.users (country);
CREATE INDEX idx_users_city                ON public.users (city);
CREATE INDEX idx_users_ranking_points      ON public.users (ranking_points DESC);
