-- Migration: 064_exclude_off_draw_picks
-- Stops user_player_stats counting picks for players who are not in the
-- tournament's draw at all.
--
-- Found while verifying 063 against production: 708 of 14,713 global pick
-- slots (4.8%), spread over 18 tournaments, name a player absent from that
-- tournament's stored bracket_data. Two causes, both real:
--
--   * 416 picks name a `qualifier-N` placeholder. When that slot resolves to a
--     real player, applyQualifierRemaps() is supposed to rewrite the pick — but
--     it only runs inside the sync-draws cron, which is idle by design here
--     because draws are entered by hand. So the remap never happened and the
--     pick still points at a placeholder that no longer exists in the draw.
--     Concentrated in Mifel (245), Grand Prix Hassan II (90), Tiriac (74).
--
--   * 292 picks name a real, registered player who is nonetheless not in the
--     draw — a late withdrawal or a draw correction re-entered manually after
--     users had already picked. Spread thinly: DC Open 57, Madrid 37,
--     Monte-Carlo 37, Wimbledon 31, and so on.
--
-- These picks cannot ever score: scoring joins predictions to match_results,
-- and no match_result exists for a player who never appeared in the draw. So
-- points, ranking_points, leagues and the point_ledger are all unaffected, and
-- nothing here needs backfilling. The damage was confined to the Players panel,
-- where such a pick inflated `picks`, depressed `avg` (points over a pick that
-- could never pay), and — once 063 added a draw-derived denominator — produced
-- a player with picks but zero opportunities.
--
-- Excluding them is consistent with vocabulary the app already uses: a pick for
-- a round the player never reached is `void` (058/060). A pick for a player who
-- is not in the draw at all is void by the same reasoning, and more plainly so.
--
-- The stranded picks are deliberately left in predictions.picks. Repairing them
-- is not possible: for a qualifier we would need the pre-resolution draw to know
-- which player took the slot, and the draws table stores only current
-- bracket_data with no history. Filtering at read time is the honest option.
--
-- Adding no columns, but the body changes — a plain CREATE OR REPLACE is fine
-- here since the OUT-parameter list is identical to 063's.

create or replace function public.user_player_stats(p_user_id uuid, p_limit int default 12)
returns table (
  external_id   text,
  name          text,
  country       text,
  picks         bigint,
  points        bigint,
  opportunities bigint
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
  tournament_draws as (
    select pr.tournament_id, d.bracket_data
    from preds pr
    join public.draws d on d.tournament_id = pr.tournament_id
  ),
  -- Every player appearing anywhere in each draw. Scans all rounds rather than
  -- just the first: in a hand-built draw the later rounds carry null slots, so
  -- this is equivalent today, but it stays correct if a draw is ever stored
  -- with players seeded directly into a later round.
  draw_players as (
    select distinct
      td.tournament_id,
      slot.p ->> 'externalId' as ext_id
    from tournament_draws td
    cross join lateral jsonb_array_elements(td.bracket_data -> 'matches') m
    cross join lateral (values (m -> 'player1'), (m -> 'player2')) as slot(p)
    where jsonb_typeof(slot.p) = 'object'
  ),
  picked as (
    -- One row per (prediction, match) slot backed, so backing someone deep
    -- counts once per round. The join to draw_players is an INNER join on
    -- purpose: it drops picks naming a player absent from that tournament's
    -- draw, which is the whole point of this migration.
    select kv.value as ext_id, count(*) as picks
    from preds pr
    cross join lateral jsonb_each_text(pr.picks) kv
    join draw_players dp
      on dp.tournament_id = pr.tournament_id
     and dp.ext_id        = kv.value
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
  ),
  draw_rounds as (
    select
      td.tournament_id,
      min(round_ordinal(m ->> 'round')) as first_round_ord
    from tournament_draws td, lateral jsonb_array_elements(td.bracket_data -> 'matches') m
    group by td.tournament_id
  ),
  -- Both slots must be unnested into their own rows. A coalesce() of the two
  -- externalIds returns only the first non-null, which silently drops every
  -- player2 in the draw — the bug 063 shipped and this file preserves the fix
  -- for. jsonb_typeof(slot.p) = 'object' keeps only real players, which also
  -- discards the empty side of a bye without needing to know which side it was.
  first_round_entrants as (
    select
      td.tournament_id,
      slot.p ->> 'externalId' as ext_id,
      (coalesce(jsonb_typeof(m -> 'player1'), 'null') = 'null')
        <> (coalesce(jsonb_typeof(m -> 'player2'), 'null') = 'null') as is_bye
    from tournament_draws td
    join draw_rounds dr on dr.tournament_id = td.tournament_id
    cross join lateral jsonb_array_elements(td.bracket_data -> 'matches') m
    cross join lateral (values (m -> 'player1'), (m -> 'player2')) as slot(p)
    where round_ordinal(m ->> 'round') = dr.first_round_ord
      and jsonb_typeof(slot.p) = 'object'
  ),
  opportunities as (
    select
      fre.ext_id,
      sum((8 - dr.first_round_ord) - case when fre.is_bye then 1 else 0 end) as opportunities
    from first_round_entrants fre
    join draw_rounds dr on dr.tournament_id = fre.tournament_id
    where fre.ext_id is not null
    group by fre.ext_id
  )
  select
    pk.ext_id                       as external_id,
    pl.name                         as name,
    pl.country                      as country,
    pk.picks,
    coalesce(e.points, 0)           as points,
    -- Retained as a guard on picks <= opportunities, which every consumer of
    -- this ratio may assume. With off-draw picks now excluded above, the known
    -- cause of a shortfall is gone and this is expected to be inert: if it ever
    -- actually raises a value, the draw-derived numerator and denominator have
    -- diverged again and that is a bug worth chasing, not absorbing.
    greatest(pk.picks, coalesce(o.opportunities, 0)) as opportunities
  from picked pk
  left join earned e        on e.ext_id = pk.ext_id
  left join opportunities o on o.ext_id = pk.ext_id
  -- Names come from the registry rather than a draw snapshot: an all-time view
  -- spans many draws, and the registry is the one place that has every player.
  left join public.players pl on pl.external_id = pk.ext_id
  order by coalesce(e.points, 0) desc, pk.picks desc
  limit greatest(p_limit, 1);
$$;

-- CREATE OR REPLACE preserves existing grants, but reassert them so this file
-- stands alone if it is ever replayed against a fresh database.
revoke all on function public.user_player_stats(uuid, int) from public, anon, authenticated;
grant execute on function public.user_player_stats(uuid, int) to service_role;
