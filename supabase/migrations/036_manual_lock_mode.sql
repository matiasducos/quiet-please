-- 036: Add manual lock prediction mode
-- Adds locked_matches JSONB column to draws table for per-match admin locking.

ALTER TABLE public.draws
  ADD COLUMN IF NOT EXISTS locked_matches jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.draws.locked_matches IS
  'Admin-locked matches: { matchId: ISO timestamp, ... }. Only enforced when prediction_mode = manual_lock.';
