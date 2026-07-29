-- Migration: 060_rename_void_picks
-- Renames the "dead" column returned by user_player_round_detail to "voided".
--
-- Terminology only: a pick for a round the player never reached is now called a
-- void pick throughout the app. The column has to be renamed rather than
-- aliased because the app reads it by name, and a function's OUT parameters are
-- part of its signature — hence the drop and recreate rather than a
-- create-or-replace.
--
-- Logic is unchanged from 058.

-- user_player_round_detail depends on user_player_picks, so both are recreated.
drop function if exists public.user_player_round_detail(uuid, text);
drop function if exists public.user_player_picks(uuid, text);

create or replace function public.user_player_picks(p_user_id uuid, p_external_id text)
returns table (
  tournament_id uuid,
  round         text,
  is_win        boolean,
  is_void       boolean,
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
    (e.exit_ord is not null and round_ordinal(r.round) > e.exit_ord) as is_void,
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
  voided     bigint,
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
    count(*) filter (where is_void)     as voided,
    coalesce(sum(points), 0)::bigint    as points
  from public.user_player_picks(p_user_id, p_external_id)
  where round is not null
  group by round
  order by round_ordinal(round);
$$;

revoke all on function public.user_player_picks(uuid, text)        from public, anon, authenticated;
revoke all on function public.user_player_round_detail(uuid, text) from public, anon, authenticated;
grant execute on function public.user_player_picks(uuid, text)        to service_role;
grant execute on function public.user_player_round_detail(uuid, text) to service_role;
