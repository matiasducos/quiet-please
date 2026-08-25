-- Migration: 093_award_points_workset_fix
-- Description: Fix award_points_workset() returning 807 rows in steady state.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHAT 092 GOT WRONG
--
-- 092 bounded its second arm with "correct pick AND no point_ledger row". Run
-- against production that returns 807 rows with nothing new to score, and every
-- single one is category 250, round R64 — the tier and round that pay ZERO by
-- design (POINTS_TABLE has no R64 entry for 250/500 and getPointsForRound ends
-- in `?? 0`, matching the ATP rule that a first-round loser at those tiers earns
-- nothing).
--
-- A correct pick worth zero points never writes a ledger row, because the JS
-- loop hits `if (basePoints <= 0) continue` before the ledger push. So those
-- pairs are "unpaid" forever, and 092 hands them back on every run — the exact
-- non-shrinking failure 092's own comment accused the naive ledger anti-join of.
-- The repo already knew this: "a ledger row proves a pick was right; its absence
-- proves nothing."
--
-- The fixture in 092 passed because it never modelled a zero-point round. It
-- took real rows to see it, which is the whole reason this codebase insists SQL
-- be checked against production data and not just a hand-built case.
--
-- THE FIX
--
-- The second arm exists for one situation: a bracket edited after its match was
-- already scored. That is a statement about the PREDICTION changing, not about
-- the ledger, so bound it on the prediction. `predictions.updated_at >
-- match_results.scored_at` says precisely "this bracket changed after we scored
-- this match" and needs no knowledge of what any round is worth — so it cannot
-- drift when POINTS_TABLE is retuned, which it was on 2026-08-24.
--
-- Measured on production: 807 rows -> 4, and those 4 are genuine mid-tournament
-- edits (consistent with the known ~2% of ledger rows sitting on a match whose
-- current pick differs).
-- ============================================================


-- ── Make updated_at authoritative for pick changes ───────────────────────────
-- The save path in predict/actions.ts sets updated_at by hand, but
-- lib/tennis/qualifier-remap.ts rewrites `picks` without it, so a bracket
-- repaired after a draw re-save would not be re-scored.
--
-- Scoped to `UPDATE OF picks` with a DISTINCT guard, NOT a blanket before-update
-- trigger. award-points itself writes pick_locks and points_earned to these rows
-- on every run; a blanket trigger would bump updated_at past every scored_at and
-- make the second arm return the entire table again — reintroducing the bug in a
-- new form.
DROP TRIGGER IF EXISTS predictions_touch_updated_at ON public.predictions;
CREATE TRIGGER predictions_touch_updated_at
  BEFORE UPDATE OF picks ON public.predictions
  FOR EACH ROW
  WHEN (OLD.picks IS DISTINCT FROM NEW.picks)
  EXECUTE FUNCTION public.touch_updated_at();


-- ── Corrected workset ────────────────────────────────────────────────────────
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
    (mr.score IS NULL OR mr.score <> 'BYE')
    AND p.picks ? mr.external_match_id
    AND NOT (p.locked_picks ? mr.external_match_id)
    AND (
      -- Never processed. Needed even when the pick lost, because the points
      -- email counts a loss on the run that first sees the result.
      mr.scored_at IS NULL
      -- Already processed, but this bracket has been edited since. Bounded by
      -- the prediction's own timestamp rather than by the absence of a ledger
      -- row, because "no ledger row" is also true of every correct pick in a
      -- round worth zero points — see the header.
      OR (
        p.updated_at > mr.scored_at
        AND (p.picks ->> mr.external_match_id) = mr.winner_external_id
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

REVOKE EXECUTE ON FUNCTION public.award_points_workset() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.award_points_workset() TO service_role;

-- Supports the `p.updated_at > mr.scored_at` comparison on the join's inner side.
CREATE INDEX IF NOT EXISTS idx_predictions_tournament_updated
  ON public.predictions (tournament_id, updated_at);
