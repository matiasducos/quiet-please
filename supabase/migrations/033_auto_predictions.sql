-- Migration: 033_auto_predictions
-- Adds: auto-prediction infrastructure — player priority lists, pick source tracking,
--        audit table, notification type, and admin toggle.

-- ── 1. auto_predict_players — user's priority player lists per tour/surface ──

CREATE TABLE public.auto_predict_players (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tour               TEXT        NOT NULL CHECK (tour IN ('ATP', 'WTA')),
  surface            TEXT        CHECK (surface IN ('hard', 'clay', 'grass')),
  -- surface = NULL → default list for all surfaces
  -- surface = 'hard'/'clay'/'grass' → override for that surface
  player_external_id TEXT        NOT NULL,
  player_name        TEXT        NOT NULL,   -- denormalized for display without join
  priority           INT         NOT NULL CHECK (priority BETWEEN 1 AND 5),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique indexes: NULL-safe for the surface column
-- Default list (surface IS NULL): unique priority per user+tour
CREATE UNIQUE INDEX idx_auto_predict_default_priority
  ON public.auto_predict_players (user_id, tour, priority)
  WHERE surface IS NULL;

-- Surface override (surface IS NOT NULL): unique priority per user+tour+surface
CREATE UNIQUE INDEX idx_auto_predict_surface_priority
  ON public.auto_predict_players (user_id, tour, surface, priority)
  WHERE surface IS NOT NULL;

-- Default list: same player can't appear twice per user+tour
CREATE UNIQUE INDEX idx_auto_predict_default_player
  ON public.auto_predict_players (user_id, tour, player_external_id)
  WHERE surface IS NULL;

-- Surface override: same player can't appear twice per user+tour+surface
CREATE UNIQUE INDEX idx_auto_predict_surface_player
  ON public.auto_predict_players (user_id, tour, surface, player_external_id)
  WHERE surface IS NOT NULL;

-- Fast lookup for cron: all configs for a set of users
CREATE INDEX idx_auto_predict_user_tour
  ON public.auto_predict_players (user_id, tour);

-- RLS
ALTER TABLE public.auto_predict_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own auto-predict players"
  ON public.auto_predict_players FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own auto-predict players"
  ON public.auto_predict_players FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own auto-predict players"
  ON public.auto_predict_players FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own auto-predict players"
  ON public.auto_predict_players FOR DELETE
  USING (auth.uid() = user_id);


-- ── 2. users.auto_predict_enabled — admin-controlled toggle ─────────────────

ALTER TABLE public.users
  ADD COLUMN auto_predict_enabled BOOLEAN NOT NULL DEFAULT false;


-- ── 3. predictions.pick_sources — per-pick "auto" vs "manual" tracking ──────

ALTER TABLE public.predictions
  ADD COLUMN pick_sources JSONB;

-- Backfill: every existing pick is manual
UPDATE public.predictions
SET pick_sources = (
  SELECT jsonb_object_agg(key, 'manual')
  FROM jsonb_each_text(picks)
)
WHERE picks IS NOT NULL
  AND picks != '{}'::jsonb
  AND pick_sources IS NULL;


-- ── 4. auto_predict_runs — audit log for cron runs ──────────────────────────

CREATE TABLE public.auto_predict_runs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id        UUID        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  triggered_by         TEXT        NOT NULL CHECK (triggered_by IN ('cron', 'draw_change', 'admin')),
  users_processed      INT         NOT NULL DEFAULT 0,
  predictions_created  INT         NOT NULL DEFAULT 0,
  predictions_updated  INT         NOT NULL DEFAULT 0,
  errors               JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auto_predict_runs_tournament
  ON public.auto_predict_runs (tournament_id, created_at DESC);

-- No RLS — only written by cron via admin client
ALTER TABLE public.auto_predict_runs ENABLE ROW LEVEL SECURITY;


-- ── 5. Notification type: auto_predictions_generated ────────────────────────

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
    'league_ownership_transferred',
    'auto_predictions_generated'
  ));
