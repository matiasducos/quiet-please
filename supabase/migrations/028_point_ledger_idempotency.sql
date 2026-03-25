-- Migration 028: Cron idempotency + index gaps
--
-- A. Unique constraint on point_ledger(match_result_id, prediction_id) to prevent
--    double-awarding points if the cron retries or runs concurrently.
-- B. Missing league_members indexes for membership checks and leaderboard sorts.

-- ── A. Point ledger idempotency ─────────────────────────────────────────────

-- Drop the old non-unique index (the unique constraint implicitly creates one)
DROP INDEX IF EXISTS idx_point_ledger_match_prediction;

-- Prevents duplicate (match_result, prediction) pairs at the DB level
ALTER TABLE public.point_ledger
  ADD CONSTRAINT uq_point_ledger_match_prediction
  UNIQUE (match_result_id, prediction_id);

-- ── B. League member indexes ────────────────────────────────────────────────

-- Membership checks: .eq('league_id', id).eq('user_id', userId)
CREATE INDEX IF NOT EXISTS idx_league_members_league_user
  ON public.league_members (league_id, user_id);

-- Leaderboard sorts: .eq('league_id', id).order('total_points', desc)
CREATE INDEX IF NOT EXISTS idx_league_members_league_points
  ON public.league_members (league_id, total_points DESC);
