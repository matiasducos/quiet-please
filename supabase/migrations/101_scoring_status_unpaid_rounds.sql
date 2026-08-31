-- Migration: 101_scoring_status_unpaid_rounds
-- Stop reporting zero-point rounds as unawarded work.
--
-- 054/055 defined pending work as "a correct, non-locked pick on a played
-- result with no point_ledger row". That asserts an invariant the award-points
-- cron never promised. The cron skips a result before it looks at any
-- prediction when the round pays nothing:
--
--     const basePoints = getPointsForRound(tournament.category, result.round, isWinner)
--     if (basePoints <= 0) continue
--
-- and POINTS_TABLE has no R64 row for the '250' and '500' tiers, deliberately —
-- that is the ATP rule, a first-round loser at a 250 earns no ranking points.
-- So a correct R64 pick at a 250 is *finished*, not pending, and no run of the
-- cron will ever write it a ledger row.
--
-- Winston-Salem 2026 was the first 250 played here. Its 16 first-round matches
-- produced 807 correct picks that the admin panel reported as "807 correct
-- picks not awarded" permanently: pressing "Award Points Now" ran a convergent
-- job that correctly wrote nothing, and the banner recomputed the same 807.
-- drift_predictions was 0 throughout — scoring was right the whole time, the
-- metric watching it was wrong.
--
-- Fix: the caller passes the (category, round) pairs that pay nothing, and
-- unscored_picks ignores them. The list is derived in TypeScript by
-- `unpaidRounds()` (src/lib/tennis/points.ts) from `getPointsForRound` — the
-- same function the cron scores with — so this function never holds its own
-- copy of the points table and cannot drift from it. Passing '[]'::jsonb
-- restores the old (over-reporting) behaviour exactly.
--
-- correct_picks is unchanged and still counts these picks: they ARE correct,
-- they just pay nothing. Only the pending-work count treats them as done.

drop function if exists public.scoring_status(uuid[]);

create or replace function public.scoring_status(
  p_tournament_ids uuid[],
  p_unpaid_rounds  jsonb default '[]'::jsonb  -- [{"category":"250","round":"R64"}, …]
)
returns table (
  tournament_id      uuid,
  total_results      bigint,  -- played, non-BYE matches
  correct_picks      bigint,  -- correct, non-locked picks across all predictions
  unscored_picks     bigint,  -- correct picks that should have a ledger row and don't
  drift_predictions  bigint   -- predictions whose stored total disagrees with the ledger
)
language sql
stable
security definer
set search_path = public
as $$
  with unpaid as (
    select x.category, x.round
    from jsonb_to_recordset(coalesce(p_unpaid_rounds, '[]'::jsonb))
      as x(category text, round text)
  ),
  results as (
    select
      mr.id, mr.tournament_id, mr.external_match_id, mr.winner_external_id,
      -- Would a correct pick on this match earn a ledger row? Mirrors all three
      -- of the cron's pre-scoring guards: it skips a result with no category
      -- (`if (!tournament?.category) continue`), and a NULL or unpaid round
      -- both reach `getPointsForRound`'s `?? 0` and fail `basePoints <= 0`.
      (
        t.category is not null
        and mr.round is not null
        and not exists (
          select 1 from unpaid u
          where u.category = t.category and u.round = mr.round
        )
      ) as pays
    from public.match_results mr
    join public.tournaments t on t.id = mr.tournament_id
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
    select p.tournament_id, r.id as match_result_id, p.id as prediction_id, r.pays
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
    where correct.pays
      and not exists (
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

-- Admin-only surface: called through the service-role client, never the browser.
revoke all on function public.scoring_status(uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.scoring_status(uuid[], jsonb) to service_role;
