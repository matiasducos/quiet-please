-- Migration: 055_scoring_status_gin_index
-- Make scoring_status() scale with user count.
--
-- 054 matched picks with `p.picks ->> r.external_match_id = r.winner_external_id`.
-- That expression is not indexable, so Postgres evaluates it once per
-- (prediction x result) pair — measured at ~1.65s per million pairs. At 10k users
-- a full admin page render would reach ~4M pairs (~6.7s).
--
-- Containment (`@>`) is indexable by GIN, so the same test becomes an index
-- lookup per result instead of a scan over every prediction. Return type and
-- semantics are unchanged; only the access path differs.

-- jsonb_path_ops supports @> (the only operator needed here) and produces a
-- smaller, faster index than the default jsonb_ops.
create index if not exists idx_predictions_picks_gin
  on public.predictions using gin (picks jsonb_path_ops);

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
    -- Index-backed equivalent of
    --   picks ->> external_match_id = winner_external_id
    -- The NULL guards matter: jsonb_build_object(k, NULL) yields {"k": null},
    -- which @> would match against a prediction storing an explicit null,
    -- whereas the ->> form returns NULL and excludes the row.
    select p.tournament_id, r.id as match_result_id, p.id as prediction_id
    from results r
    join public.predictions p
      on p.tournament_id = r.tournament_id
     and p.picks @> jsonb_build_object(r.external_match_id, r.winner_external_id)
    where r.winner_external_id is not null
      and r.external_match_id is not null
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
