-- Migration: 100_backfill_pick_lock_times
-- Description: Give commitments made before 099 their real lock time, so a live
--              tournament is scored by one rule instead of two.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- THE PROBLEM THIS FIXES
--
-- 099 made the streak multiplier require a commitment predating the feeder
-- match, and made that forward-only: a pick with no recorded lock time falls
-- back to the old rule. Safe, but it left the US Open mid-flight under two
-- rules — picks committed before the migration judged the old way, picks
-- committed after judged the new way.
--
-- WHY A BACKFILL IS EXACT HERE AND NOT A GUESS
--
-- pick_locks[matchId] = 'auto_lock_all' is written by "Lock all picks", in the
-- same statement that sets fully_locked_at. So for those entries
-- fully_locked_at IS the commitment time, recovered rather than estimated.
--
-- On the live draw that covers 6,804 of the 6,881 commitments above round one.
-- Every one of them is 'auto_lock_all' — there is not a single 'round' or
-- 'voluntary' entry on a fully-locked bracket, so nothing has to be
-- approximated. The remaining 67 have no timestamp evidence of any kind and are
-- left alone to fall back to the old rule; they belong to the QA bot (62) and
-- the operator's own bracket (5), so no real user is affected by that gap.
--
-- WHY IT IS SAFE TO RUN
--
-- Restricted to tournaments still in progress. A completed tournament must NOT
-- be backfilled: it has already been scored, and giving its picks lock times
-- would let a re-run apply the stacking rule to points already awarded —
-- exactly the silent repricing 099 was written to avoid. The live draw has zero
-- point_ledger rows above R128, so nothing here has been scored under either
-- rule and nothing changes retroactively.
--
-- Adds only missing keys (`||` with the existing map on the left of the new
-- entries would overwrite; it is on the right, so recorded times win).
-- ============================================================

UPDATE public.predictions p
SET pick_lock_times = (
      SELECT COALESCE(
               jsonb_object_agg(
                 e.key,
                 to_char(p.fully_locked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
               ), '{}'::jsonb)
      FROM jsonb_each_text(COALESCE(p.pick_locks, '{}'::jsonb)) AS e
      WHERE e.value = 'auto_lock_all'
        AND NOT (COALESCE(p.pick_lock_times, '{}'::jsonb) ? e.key)
    ) || COALESCE(p.pick_lock_times, '{}'::jsonb)
FROM public.tournaments t
WHERE t.id = p.tournament_id
  AND t.status IN ('in_progress', 'accepting_predictions')
  AND p.fully_locked_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_each_text(COALESCE(p.pick_locks, '{}'::jsonb)) AS e
    WHERE e.value = 'auto_lock_all'
      AND NOT (COALESCE(p.pick_lock_times, '{}'::jsonb) ? e.key)
  );
