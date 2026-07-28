-- Migration: 054_scoring_status_pending_work
-- Redefine scoring_status() to report award-points *work*, not participation.
--
-- 053 counted match_results that had no point_ledger row. That conflated two
-- unrelated things: matches the cron hasn't scored yet, and matches nobody
-- predicted correctly. The second is not an admin concern — a tournament with
-- no entrants showed "95 unscored" with nothing to do.
--
-- This version asserts the award-points cron's own invariants, the same ones
-- scripts/verify-scoring.mjs checks:
--   1. every correct, non-locked pick on a played result has a point_ledger row
--      for that (match_result, prediction) pair;
--   2. predictions.points_earned equals SUM(point_ledger.points) for that
--      prediction.
-- Both zero => scoring is converged and nothing is left behind.

drop function if exists public.scoring_status(uuid[]);

create or replace function public.scoring_status(p_tournament_ids uuid[])
returns table (
  tournament_id      uuid,
  total_results      bigint,  -- played, non-BYE matches
  correct_picks      bigint,  -- correct, non-locked picks across all predictions
  unscored_picks     bigint,  -- correct picks with no ledger row  ← real pending work
  drift_predictions  bigint   -- predictions whose stored total disagrees with the ledger
)
language sql
stable
security definer
set search_path = public
as $$
  with results as (
    select mr.id, mr.tournament_id, mr.external_match_id, mr.winner_external_id
    from public.match_results mr
    where mr.tournament_id = any(p_tournament_ids)
      -- NULL-safe: API-synced results carry no score string. `<> 'BYE'` would
      -- evaluate to NULL for those and silently drop them.
      and mr.score is distinct from 'BYE'
  ),
  totals as (
    select results.tournament_id, count(*) as total_results
    from results group by results.tournament_id
  ),
  correct as (
    -- A pick is correct when the prediction's entry for that match equals the
    -- actual winner. Admin-locked matches are excluded, matching the cron.
    select p.tournament_id, r.id as match_result_id, p.id as prediction_id
    from public.predictions p
    join results r on r.tournament_id = p.tournament_id
    where p.picks ->> r.external_match_id = r.winner_external_id
      and not (p.locked_picks @> to_jsonb(r.external_match_id))
  ),
  correct_totals as (
    select correct.tournament_id, count(*) as correct_picks
    from correct group by correct.tournament_id
  ),
  unscored as (
    select correct.tournament_id, count(*) as unscored_picks
    from correct
    where not exists (
      select 1 from public.point_ledger pl
      where pl.match_result_id = correct.match_result_id
        and pl.prediction_id   = correct.prediction_id
    )
    group by correct.tournament_id
  ),
  ledger_sums as (
    select pl.prediction_id, sum(pl.points) as total
    from public.point_ledger pl
    where pl.tournament_id = any(p_tournament_ids)
    group by pl.prediction_id
  ),
  drift as (
    select p.tournament_id, count(*) as drift_predictions
    from public.predictions p
    left join ledger_sums ls on ls.prediction_id = p.id
    where p.tournament_id = any(p_tournament_ids)
      and coalesce(p.points_earned, 0) <> coalesce(ls.total, 0)
    group by p.tournament_id
  )
  select
    t.id                              as tournament_id,
    coalesce(tt.total_results, 0)     as total_results,
    coalesce(ct.correct_picks, 0)     as correct_picks,
    coalesce(u.unscored_picks, 0)     as unscored_picks,
    coalesce(d.drift_predictions, 0)  as drift_predictions
  from unnest(p_tournament_ids) as t(id)
  left join totals         tt on tt.tournament_id = t.id
  left join correct_totals ct on ct.tournament_id = t.id
  left join unscored       u  on u.tournament_id  = t.id
  left join drift          d  on d.tournament_id  = t.id;
$$;

revoke all on function public.scoring_status(uuid[]) from public, anon, authenticated;
grant execute on function public.scoring_status(uuid[]) to service_role;

-- Supports the predictions x results join and the (match_result, prediction)
-- existence check.
create index if not exists idx_predictions_tournament_id
  on public.predictions (tournament_id);

create index if not exists idx_point_ledger_result_prediction
  on public.point_ledger (match_result_id, prediction_id);
