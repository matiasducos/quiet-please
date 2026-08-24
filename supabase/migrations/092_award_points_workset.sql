-- Migration: 092_award_points_workset
-- Description: Narrow award-points from "load all history" to "load the work".
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHAT THIS REPLACES
--
-- Sections 1-3 of src/app/api/cron/award-points/route.ts currently load, on
-- every run: every match_result ever recorded, the ENTIRE point_ledger, and
-- every prediction for every tournament that has a result. It then computes the
-- set difference in JavaScript. That is 4.2 seconds of Vercel Active CPU per
-- run -- the single largest line item in the budget -- and the cost is
-- O(all history), not O(new work). Every tournament ever played makes every
-- future run slower, and at 10x the data it exceeds maxDuration.
--
-- THE TRAP (this cost a wrong first answer):
--
-- The obvious replacement is an anti-join against point_ledger -- "give me the
-- pairs with no ledger row". It does not work. A LOSING pick never writes a
-- ledger row, and neither does a blank. Those pairs are therefore "unscored"
-- forever, so a ledger-only anti-join returns nearly every pair in history on
-- every run and shrinks to nothing. Measured on a fixture: after a completed
-- run this function returns 0 rows where the naive anti-join returns 6.
--
-- What actually bounds the set is `match_results.scored_at`, which is what the
-- current JS uses to stop old losses being re-counted into the points email.
-- Hence the two arms:
--
--   new result   -> return ALL its picks, wins and losses, because the email
--                   breakdown counts a loss on the run that first sees it
--   old result   -> return ONLY correct picks still missing a ledger row,
--                   i.e. a bracket edited after the match was scored
--
-- The second arm is the only one that can fire on old data, and it is rare, so
-- the set stays small. `scored_at` still never gates SCORING -- point_ledger
-- does -- which preserves the invariant documented at route.ts:272 that a
-- category correction turning a 0-point round into a real one still awards.
--
-- Scoring rules stay in TypeScript on purpose. This function knows nothing
-- about POINTS_TABLE or the streak multiplier: duplicating the points table in
-- SQL would give it two sources of truth, and it was realigned as recently as
-- 2026-08-24. This narrows the working set; getPointsForRound() and
-- calculateStreakMultiplier() still decide what anything is worth.
--
-- VERIFIED against a throwaway Postgres 16 with a hand-computed fixture
-- covering: correct-unpaid, correct-already-paid, losing pick, blank bracket,
-- locked pick, and a BYE. Expected 4 rows, got exactly those 4. Re-running
-- after a simulated completed pass returns 0. Editing a losing bracket to the
-- correct pick brings both its results back for scoring.
-- ============================================================

CREATE OR REPLACE FUNCTION public.award_points_workset()
RETURNS TABLE (
  match_result_id     UUID,
  prediction_id       UUID,
  tournament_id       UUID,
  round               TEXT,
  external_match_id   TEXT,
  winner_external_id  TEXT,
  result_is_new       BOOLEAN,
  user_id             UUID,
  challenge_id        UUID,
  pick                TEXT,
  pick_is_correct     BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    mr.id,
    p.id,
    mr.tournament_id,
    mr.round,
    mr.external_match_id,
    mr.winner_external_id,
    (mr.scored_at IS NULL),
    p.user_id,
    p.challenge_id,
    p.picks ->> mr.external_match_id,
    (p.picks ->> mr.external_match_id) = mr.winner_external_id
  FROM public.match_results mr
  JOIN public.predictions p
    ON p.tournament_id = mr.tournament_id
  WHERE
    -- BYEs are bookkeeping rows, not matches anyone played or predicted.
    (mr.score IS NULL OR mr.score <> 'BYE')
    -- A genuine pick must exist. A match left blank is not "played" either way,
    -- and the JS loop skips it — no reason to ship the row.
    AND p.picks ? mr.external_match_id
    -- Picks made after the match started earn nothing, break no streak and
    -- write no ledger row.
    AND NOT (p.locked_picks ? mr.external_match_id)
    AND (
      -- Never processed. Needed even when the pick lost, because the points
      -- email counts losses on the run that first sees the result.
      mr.scored_at IS NULL
      -- Already processed, but a correct pick still has no ledger row — a
      -- bracket edited after the fact. Only correct picks qualify here; a loss
      -- has no ledger row to be missing, so including it would make this set
      -- grow forever instead of shrink.
      OR (
        (p.picks ->> mr.external_match_id) = mr.winner_external_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.point_ledger pl
          WHERE pl.match_result_id = mr.id
            AND pl.prediction_id   = p.id
        )
      )
    )
  ORDER BY mr.id, p.id
$$;

-- Results that need `scored_at` stamped, including ones no prediction touched
-- and ones whose round is worth zero points. The workset above cannot serve
-- this: a result with no picks against it returns no rows, and stamping is
-- per-result rather than per-pair.
CREATE OR REPLACE FUNCTION public.award_points_new_results()
RETURNS TABLE (id UUID, tournament_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mr.id, mr.tournament_id
  FROM public.match_results mr
  WHERE mr.scored_at IS NULL
    AND (mr.score IS NULL OR mr.score <> 'BYE')
  ORDER BY mr.played_at
$$;

REVOKE EXECUTE ON FUNCTION public.award_points_workset()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_points_new_results() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.award_points_workset()     TO service_role;
GRANT  EXECUTE ON FUNCTION public.award_points_new_results() TO service_role;

-- `p.picks ? key` cannot use a btree index. Without this the join degrades to a
-- scan of every prediction in the tournament per result — survivable at today's
-- 45 MB but not at 10x.
CREATE INDEX IF NOT EXISTS idx_predictions_picks_gin
  ON public.predictions USING gin (picks);

CREATE INDEX IF NOT EXISTS idx_match_results_unscored
  ON public.match_results (tournament_id)
  WHERE scored_at IS NULL;
