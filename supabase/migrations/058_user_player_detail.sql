-- Migration: 058_user_player_detail
-- Per-player deep dive for the profile Stats tab: how one user has fared backing
-- one particular player, broken down by round and by tournament.
--
-- Has to be SQL for the same reason as 057: answering it needs every
-- match_result across every tournament the user entered, which for the heaviest
-- current user is already 1,010 rows — past the 1000-row PostgREST cap. Done
-- client-side it would silently under-report.
--
-- Definitions used throughout:
--   pick  — one bracket slot where the user picked this player to win. A bracket
--           is filled in before play, so a player picked to reach the final has
--           7 picks whether or not they ever played 7 matches.
--   win   — a pick whose match was played and won by that player.
--   dead  — a pick for a round later than the one the player was knocked out in.
--           These can never be won, and are the usual reason a win rate looks
--           poor: backing someone deep costs a pick per round regardless.

-- Round ordering, needed to tell a dead pick from a live one.
create or replace function public.round_ordinal(p_round text)
returns int
language sql
immutable
as $$
  select case p_round
    when 'R128' then 1 when 'R64' then 2 when 'R32' then 3 when 'R16' then 4
    when 'QF' then 5 when 'SF' then 6 when 'F' then 7 else 0 end;
$$;

-- Shared skeleton: every pick this user made on this player, with the round it
-- was for, whether it was won, what it paid, and whether it was already dead.
create or replace function public.user_player_picks(p_user_id uuid, p_external_id text)
returns table (
  tournament_id uuid,
  round         text,
  is_win        boolean,
  is_dead       boolean,
  points        bigint
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
  picks as (
    select pr.id as prediction_id, pr.tournament_id, kv.key as match_key
    from preds pr, lateral jsonb_each_text(pr.picks) kv
    where kv.value = p_external_id
  ),
  -- Round comes from the played result when there is one, otherwise from the
  -- draw, so picks for matches not yet played still land in the right round.
  resolved as (
    select
      pk.prediction_id,
      pk.tournament_id,
      mr.id as match_result_id,
      coalesce(mr.round, dr.round) as round,
      (mr.winner_external_id = p_external_id) as is_win
    from picks pk
    left join public.match_results mr
      on mr.tournament_id = pk.tournament_id
     and mr.external_match_id = pk.match_key
     and mr.score is distinct from 'BYE'
    left join lateral (
      select m ->> 'round' as round
      from public.draws d, lateral jsonb_array_elements(d.bracket_data -> 'matches') m
      where d.tournament_id = pk.tournament_id
        and m ->> 'matchId' = pk.match_key
      limit 1
    ) dr on true
  ),
  -- The round this player actually went out in, per tournament.
  exits as (
    select mr.tournament_id, min(round_ordinal(mr.round)) as exit_ord
    from public.match_results mr
    where mr.loser_external_id = p_external_id
      and mr.score is distinct from 'BYE'
    group by mr.tournament_id
  )
  select
    r.tournament_id,
    r.round,
    coalesce(r.is_win, false) as is_win,
    (e.exit_ord is not null and round_ordinal(r.round) > e.exit_ord) as is_dead,
    -- Points only count when this player actually won the match. A bracket stays
    -- editable while a tournament runs, so a ledger row can outlive the pick that
    -- earned it: points awarded for correctly picking A remain attached to that
    -- match after the bracket is edited to B. Crediting them to whoever is
    -- currently picked would hand A's points to B. Attributing on the winner
    -- instead also keeps this consistent with 057.
    case when coalesce(r.is_win, false) then coalesce((
      select sum(pl.points)
      from public.point_ledger pl
      where pl.match_result_id = r.match_result_id
        and pl.prediction_id   = r.prediction_id
    ), 0) else 0 end::bigint as points
  from resolved r
  left join exits e on e.tournament_id = r.tournament_id;
$$;

create or replace function public.user_player_round_detail(p_user_id uuid, p_external_id text)
returns table (
  round      text,
  picks      bigint,
  wins       bigint,
  dead       bigint,
  points     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    round,
    count(*)                            as picks,
    count(*) filter (where is_win)      as wins,
    count(*) filter (where is_dead)     as dead,
    coalesce(sum(points), 0)::bigint    as points
  from public.user_player_picks(p_user_id, p_external_id)
  where round is not null
  group by round
  order by round_ordinal(round);
$$;

create or replace function public.user_player_tournament_detail(p_user_id uuid, p_external_id text)
returns table (
  tournament_id uuid,
  name          text,
  location      text,
  flag_emoji    text,
  starts_at     timestamptz,
  picks         bigint,
  wins          bigint,
  points        bigint,
  exit_round    text
)
language sql
stable
security definer
set search_path = public
as $$
  with agg as (
    select
      up.tournament_id,
      count(*)                         as picks,
      count(*) filter (where up.is_win) as wins,
      coalesce(sum(up.points), 0)::bigint as points
    from public.user_player_picks(p_user_id, p_external_id) up
    group by up.tournament_id
  )
  select
    a.tournament_id,
    t.name,
    t.location,
    t.flag_emoji,
    t.starts_at,
    a.picks,
    a.wins,
    a.points,
    (
      select mr.round
      from public.match_results mr
      where mr.tournament_id = a.tournament_id
        and mr.loser_external_id = p_external_id
        and mr.score is distinct from 'BYE'
      order by round_ordinal(mr.round)
      limit 1
    ) as exit_round
  from agg a
  join public.tournaments t on t.id = a.tournament_id
  order by t.starts_at desc nulls last;
$$;

-- Admin-only, like 057: these expose one user's full prediction history.
revoke all on function public.user_player_picks(uuid, text)             from public, anon, authenticated;
revoke all on function public.user_player_round_detail(uuid, text)      from public, anon, authenticated;
revoke all on function public.user_player_tournament_detail(uuid, text) from public, anon, authenticated;
grant execute on function public.user_player_picks(uuid, text)             to service_role;
grant execute on function public.user_player_round_detail(uuid, text)      to service_role;
grant execute on function public.user_player_tournament_detail(uuid, text) to service_role;

create index if not exists idx_match_results_loser_tournament
  on public.match_results (loser_external_id, tournament_id);
