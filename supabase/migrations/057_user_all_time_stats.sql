-- Migration: 057_user_all_time_stats
-- All-time prediction stats for a single user — the "Stats" tab on a profile.
--
-- The per-tournament panel derives its numbers in Node, which is fine for one
-- tournament (~127 results). All-time is a different shape: the heaviest current
-- user already spans 1,010 match_results across 25 tournaments, and would reach
-- ~5,400 within three seasons. PostgREST caps responses at 1000 rows, so the
-- Node approach would silently truncate and report wrong totals — no error.
--
-- Cost is per user, not per user base: the joins below are bounded by how many
-- tournaments that one person entered, so this does not get slower as the app
-- grows to 10k users.
--
-- Both functions scope to global predictions (challenge_id is null). Challenge
-- picks are deliberately excluded — they do not affect ranking and would
-- double-count a user's record.

-- ── Round-by-round accuracy and points, across every tournament entered ──────
create or replace function public.user_round_stats(p_user_id uuid)
returns table (
  round     text,
  decided   bigint,
  correct   bigint,
  points    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with preds as (
    select p.id, p.tournament_id, p.picks, p.locked_picks
    from public.predictions p
    where p.user_id = p_user_id
      and p.challenge_id is null
  ),
  res as (
    select mr.id, mr.round, mr.external_match_id, mr.winner_external_id, pr.picks, pr.locked_picks
    from public.match_results mr
    join preds pr on pr.tournament_id = mr.tournament_id
    -- NULL-safe: API-synced results carry no score string, and `<> 'BYE'` would
    -- evaluate to NULL for those and drop them.
    where mr.score is distinct from 'BYE'
  ),
  tally as (
    select
      res.round,
      -- distinct on the result id: migration 015 dropped the unique constraint on
      -- (user_id, tournament_id), so a duplicate prediction would otherwise
      -- inflate every count here.
      count(distinct res.id) as decided,
      count(distinct res.id) filter (
        where res.picks ->> res.external_match_id = res.winner_external_id
          and not (res.locked_picks @> to_jsonb(res.external_match_id))
      ) as correct
    from res
    group by res.round
  ),
  pts as (
    select pl.round, sum(pl.points) as points
    from public.point_ledger pl
    join preds pr on pr.id = pl.prediction_id
    group by pl.round
  )
  select
    t.round,
    t.decided,
    t.correct,
    coalesce(p.points, 0) as points
  from tally t
  left join pts p on p.round = t.round;
$$;

-- ── Which players a user backs, and what they returned ──────────────────────
create or replace function public.user_player_stats(p_user_id uuid, p_limit int default 12)
returns table (
  external_id  text,
  name         text,
  country      text,
  picks        bigint,
  points       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with preds as (
    select p.id, p.tournament_id, p.picks
    from public.predictions p
    where p.user_id = p_user_id
      and p.challenge_id is null
  ),
  picked as (
    -- Expand the picks object: one row per (prediction, match) with the player
    -- backed to win it. Backing someone deep therefore counts once per round.
    select kv.value as ext_id, count(*) as picks
    from preds pr, lateral jsonb_each_text(pr.picks) kv
    where kv.value is not null and kv.value <> ''
    group by kv.value
  ),
  earned as (
    -- A ledger row exists only for a correct pick, so the winner of that match
    -- is the player the user backed.
    select mr.winner_external_id as ext_id, sum(pl.points) as points
    from public.point_ledger pl
    join preds pr on pr.id = pl.prediction_id
    join public.match_results mr on mr.id = pl.match_result_id
    where mr.winner_external_id is not null
    group by mr.winner_external_id
  )
  select
    pk.ext_id                       as external_id,
    pl.name                         as name,
    pl.country                      as country,
    pk.picks,
    coalesce(e.points, 0)           as points
  from picked pk
  left join earned e on e.ext_id = pk.ext_id
  -- Names come from the registry rather than a draw snapshot: an all-time view
  -- spans many draws, and the registry is the one place that has every player.
  left join public.players pl on pl.external_id = pk.ext_id
  order by coalesce(e.points, 0) desc, pk.picks desc
  limit greatest(p_limit, 1);
$$;

revoke all on function public.user_round_stats(uuid)      from public, anon, authenticated;
revoke all on function public.user_player_stats(uuid, int) from public, anon, authenticated;
grant execute on function public.user_round_stats(uuid)      to service_role;
grant execute on function public.user_player_stats(uuid, int) to service_role;

-- Supports the preds scan in both functions.
create index if not exists idx_predictions_user_challenge
  on public.predictions (user_id) where challenge_id is null;

create index if not exists idx_point_ledger_prediction_id
  on public.point_ledger (prediction_id);
