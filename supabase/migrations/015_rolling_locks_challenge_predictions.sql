-- Migration: 015_rolling_locks_challenge_predictions
-- Description: Rolling per-match locks, streak multiplier scoring, challenge-specific predictions
--
-- This migration:
--   A. Adds challenge_id FK to predictions (challenge-specific picks)
--   B. Replaces unique constraint with partial unique indexes
--   C. Adds pick_locks JSONB + is_fully_locked + fully_locked_at
--   D. Adds prediction_id to point_ledger
--   E. Adds streak_multiplier to point_ledger
--   F. Drops deprecated is_locked and is_practice columns
--   G. Updates RLS policies
--   H. Replaces recalculate_ranking_points function
--   I. Migrates existing data
--
-- Steps A-D may already exist (applied manually). All statements use IF NOT EXISTS guards.

-- ── A. challenge_id on predictions ──────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'predictions' AND column_name = 'challenge_id'
  ) THEN
    ALTER TABLE public.predictions
      ADD COLUMN challenge_id UUID REFERENCES public.challenges(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_predictions_challenge_id ON public.predictions (challenge_id);

-- ── B. Replace unique constraint with partial unique indexes ────────────────
-- Drop the old unique constraint (user_id, tournament_id) if it exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictions_user_id_tournament_id_key' AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions DROP CONSTRAINT predictions_user_id_tournament_id_key;
  END IF;
END $$;

-- Global: exactly one prediction per user per tournament when no challenge
CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_global
  ON public.predictions (user_id, tournament_id)
  WHERE challenge_id IS NULL;

-- Challenge: one prediction per user per tournament per challenge
CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_challenge
  ON public.predictions (user_id, tournament_id, challenge_id)
  WHERE challenge_id IS NOT NULL;

-- ── C. Per-pick lock tracking ───────────────────────────────────────────────
-- pick_locks: JSONB mapping matchId → lock type ("auto" | "voluntary" | "auto_lock_all")
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'predictions' AND column_name = 'pick_locks'
  ) THEN
    ALTER TABLE public.predictions ADD COLUMN pick_locks JSONB NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- Full bracket voluntary lock
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'predictions' AND column_name = 'is_fully_locked'
  ) THEN
    ALTER TABLE public.predictions ADD COLUMN is_fully_locked BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'predictions' AND column_name = 'fully_locked_at'
  ) THEN
    ALTER TABLE public.predictions ADD COLUMN fully_locked_at TIMESTAMPTZ;
  END IF;
END $$;

-- ── D. prediction_id on point_ledger ────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'point_ledger' AND column_name = 'prediction_id'
  ) THEN
    ALTER TABLE public.point_ledger
      ADD COLUMN prediction_id UUID REFERENCES public.predictions(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── E. streak_multiplier on point_ledger ────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'point_ledger' AND column_name = 'streak_multiplier'
  ) THEN
    ALTER TABLE public.point_ledger ADD COLUMN streak_multiplier INTEGER NOT NULL DEFAULT 1;
  END IF;
END $$;

-- ── I. Data migration (run BEFORE dropping columns) ─────────────────────────

-- Migrate is_locked → is_fully_locked for existing locked predictions
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'predictions' AND column_name = 'is_locked'
  ) THEN
    UPDATE public.predictions
    SET is_fully_locked = true,
        fully_locked_at = updated_at
    WHERE is_locked = true AND is_fully_locked = false;
  END IF;
END $$;

-- Delete practice predictions before dropping the column
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'predictions' AND column_name = 'is_practice'
  ) THEN
    DELETE FROM public.predictions WHERE is_practice = true;
  END IF;
END $$;

-- Backfill prediction_id on existing point_ledger rows
UPDATE public.point_ledger pl
SET prediction_id = (
  SELECT p.id FROM public.predictions p
  WHERE p.user_id = pl.user_id
    AND p.tournament_id = pl.tournament_id
    AND p.challenge_id IS NULL
  LIMIT 1
)
WHERE pl.prediction_id IS NULL;

-- ── F. Drop deprecated columns ──────────────────────────────────────────────
-- Must drop the RLS policy that references is_locked BEFORE dropping the column
DROP POLICY IF EXISTS "Users can update unlocked predictions" ON public.predictions;

ALTER TABLE public.predictions DROP COLUMN IF EXISTS is_locked;
ALTER TABLE public.predictions DROP COLUMN IF EXISTS is_practice;

-- ── G. Update RLS policies ──────────────────────────────────────────────────

-- New: users can update their own predictions that aren't fully locked
CREATE POLICY "Users can update non-fully-locked predictions"
  ON public.predictions FOR UPDATE
  USING (auth.uid() = user_id AND is_fully_locked = false);

-- Allow users to read challenge predictions they participate in
-- (they can already read their own via the existing select policy;
--  this adds visibility to opponent's challenge predictions for comparison)
CREATE POLICY "Users can read challenge predictions they participate in"
  ON public.predictions FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      challenge_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.challenges c
        WHERE c.id = challenge_id
          AND (c.challenger_id = auth.uid() OR c.challenged_id = auth.uid())
      )
    )
  );

-- Drop the old select policy since the new one covers both cases
DROP POLICY IF EXISTS "Users can read their own predictions" ON public.predictions;

-- ── H. Replace recalculate_ranking_points function ──────────────────────────
-- Only counts global predictions (challenge_id IS NULL) that have positive points
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
    AND p.challenge_id  IS NULL
    AND p.points_earned > 0
    AND (p.expires_at IS NULL OR p.expires_at > NOW());

  UPDATE public.users
  SET ranking_points     = _total,
      atp_ranking_points = _atp,
      wta_ranking_points = _wta
  WHERE id = p_user_id;
END;
$$;

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_predictions_fully_locked ON public.predictions (is_fully_locked);
CREATE INDEX IF NOT EXISTS idx_point_ledger_prediction_id ON public.point_ledger (prediction_id);
