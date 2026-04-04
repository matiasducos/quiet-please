-- Migration: 039_production_readiness_indexes
-- Description: Add indexes for 100+ concurrent user performance
-- Run manually in Supabase dashboard (project is not linked locally)

-- ── CRITICAL: Hot-path page loads ────────────────────────────────────────────

-- Dashboard + predict page: user's global predictions lookup
-- Query: .eq('user_id', X).is('challenge_id', null)
CREATE INDEX IF NOT EXISTS idx_predictions_user_challenge
  ON public.predictions (user_id, challenge_id);

-- Tournament detail: check if user has a prediction for this tournament
-- Query: .eq('tournament_id', X).eq('user_id', X).is('challenge_id', null)
CREATE INDEX IF NOT EXISTS idx_predictions_tournament_user
  ON public.predictions (tournament_id, user_id);

-- Notifications page: fetch user's notifications in reverse chronological order
-- Query: .eq('user_id', X).order('created_at', desc)
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

-- Friends page + activity feed: bidirectional friendship lookup
-- Query: .or('requester_id.eq.X,addressee_id.eq.X').eq('status', 'accepted')
CREATE INDEX IF NOT EXISTS idx_friendships_requester_status
  ON public.friendships (requester_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee_status
  ON public.friendships (addressee_id, status, created_at DESC);

-- ── HIGH: Cron job performance ───────────────────────────────────────────────

-- Award-points cron: paginate match results per tournament
-- Query: .eq('tournament_id', X).order('played_at', asc)
CREATE INDEX IF NOT EXISTS idx_match_results_tournament_played
  ON public.match_results (tournament_id, played_at);

-- Award-points cron: fetch predictions per tournament for scoring
-- Query: .eq('tournament_id', X) + challenge-specific .eq('challenge_id', X)
CREATE INDEX IF NOT EXISTS idx_predictions_tournament_challenge
  ON public.predictions (tournament_id, challenge_id);

-- Award-points cron: SUM points per prediction for idempotent totals
-- Query: .eq('prediction_id', X).select('points')
CREATE INDEX IF NOT EXISTS idx_point_ledger_prediction
  ON public.point_ledger (prediction_id);

-- Activity feed: recent points per user
-- Query: .in('user_id', [...]).gte('awarded_at', X).order('awarded_at', desc)
CREATE INDEX IF NOT EXISTS idx_point_ledger_user_awarded
  ON public.point_ledger (user_id, awarded_at DESC);
