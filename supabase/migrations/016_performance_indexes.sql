-- Migration: 016_performance_indexes
-- Description: Add composite indexes for performance at scale

-- Composite index for award-points cron "already scored" lookup
-- Queries: SELECT match_result_id, prediction_id FROM point_ledger
CREATE INDEX IF NOT EXISTS idx_point_ledger_match_prediction
  ON public.point_ledger (match_result_id, prediction_id);

-- Index for challenge duplicate check (both directions)
CREATE INDEX IF NOT EXISTS idx_challenges_tournament_status
  ON public.challenges (tournament_id, status);
