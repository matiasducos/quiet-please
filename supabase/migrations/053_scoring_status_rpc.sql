-- Migration: 053_scoring_status_rpc
-- Per-tournament scoring progress for the admin "Award Points" tab.
--
-- Replaces a three-step app-side implementation that:
--   1. filtered with `score <> 'BYE'`, which drops rows where score IS NULL
--      (SQL three-valued logic) — that silently excluded 1,105 of 1,270 rows and
--      made every tournament report 0 total / 0 pending;
--   2. sent every match_result id back as an `in.(...)` URL parameter, producing a
--      ~37,000 character request that PostgREST rejects with 400 Bad Request;
--   3. rebuilt the result -> tournament mapping in Node with an O(scored × tournaments)
--      nested loop.
--
-- Cost note: point_ledger holds one row per user per correct pick, so it grows with
-- users × matches (~285 rows per match_result at 10k users). Aggregating over it
-- directly would scan ~380k rows to render one page. Instead we scan match_results
-- (~67 per tournament) and use an EXISTS semi-join, which stops at the first
-- matching ledger row. Cost tracks the number of matches, not the number of users.

create or replace function public.scoring_status(p_tournament_ids uuid[])
returns table (
  tournament_id   uuid,
  total_results   bigint,
  scored_results  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with scanned as (
    select
      mr.tournament_id,
      -- Semi-join: existence only, never materialises the matching ledger rows.
      exists (
        select 1 from public.point_ledger pl
        where pl.match_result_id = mr.id
      ) as is_scored
    from public.match_results mr
    where mr.tournament_id = any(p_tournament_ids)
      -- NULL-safe: a NULL score is a real result. `<> 'BYE'` would evaluate to
      -- NULL here and silently drop the row.
      and mr.score is distinct from 'BYE'
  ),
  agg as (
    select
      scanned.tournament_id,
      count(*)                              as total_results,
      count(*) filter (where is_scored)     as scored_results
    from scanned
    group by scanned.tournament_id
  )
  -- Driven off the input array so every requested tournament gets a row back,
  -- including ones with no results yet.
  select
    t.id                            as tournament_id,
    coalesce(a.total_results, 0)    as total_results,
    coalesce(a.scored_results, 0)   as scored_results
  from unnest(p_tournament_ids) as t(id)
  left join agg a on a.tournament_id = t.id;
$$;

-- Admin-only surface: called through the service-role client, never from the browser.
revoke all on function public.scoring_status(uuid[]) from public, anon, authenticated;
grant execute on function public.scoring_status(uuid[]) to service_role;

-- Supporting indexes: the match_results scan and the EXISTS lookup.
create index if not exists idx_match_results_tournament_id
  on public.match_results (tournament_id);

create index if not exists idx_point_ledger_match_result_id
  on public.point_ledger (match_result_id);
