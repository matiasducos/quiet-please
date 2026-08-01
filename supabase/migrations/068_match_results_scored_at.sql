-- ============================================================
-- 068: mark when award-points first processed a match result
-- ============================================================
-- The award-points cron dedupes work via point_ledger (match_result_id,
-- prediction_id). That only covers CORRECT picks — a losing pick writes no
-- ledger row, so it was re-counted on every run. The points-awarded email
-- builds its per-round "N matches played (M winners)" lines from that same
-- pass, so every email re-listed every losing pick from every earlier round.
--
-- scored_at gives the run a per-match marker that exists regardless of whether
-- anyone picked the winner: NULL = never processed, timestamp = already
-- reflected in a previous run's email.

alter table public.match_results
  add column if not exists scored_at timestamptz;

comment on column public.match_results.scored_at is
  'When award-points first processed this result. NULL = not yet processed. Used to scope the points email breakdown to the current run; points themselves are deduped via point_ledger.';

-- Backfill: everything that exists today has already been through the cron
-- (and already appeared in an email), so none of it should surface again.
update public.match_results
   set scored_at = now()
 where scored_at is null;

-- Partial index: the cron only ever asks "which results are new?".
create index if not exists idx_match_results_unscored
  on public.match_results (id)
  where scored_at is null;
