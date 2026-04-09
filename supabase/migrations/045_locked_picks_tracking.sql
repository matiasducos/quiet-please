-- Track which picks were made on admin-locked matches (no points, no streaks).
-- Array of matchId strings — checked by the scoring engine to skip these picks.

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS locked_picks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS creator_locked_picks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS opponent_locked_picks jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.predictions.locked_picks IS
  'Match IDs picked after admin lock — scored as 0 points, excluded from streaks and accuracy.';
COMMENT ON COLUMN public.challenges.creator_locked_picks IS
  'Match IDs the creator picked after admin lock (anonymous challenges).';
COMMENT ON COLUMN public.challenges.opponent_locked_picks IS
  'Match IDs the opponent picked after admin lock (anonymous challenges).';
