-- Migration: 063_user_player_pick_opportunities
-- Adds `opportunities` to user_player_stats (057): out of how many chances to
-- back a given player, how many did this user actually take?
--
-- Definitions (matching 057/058's existing vocabulary):
--   pick        — one bracket slot where the user backed this player to win.
--   opportunity — one bracket slot where the user COULD have backed this
--                 player to win, whether or not they actually did. A bracket
--                 is filled in before anyone plays, so backing any entrant
--                 from their own first real (non-bye) round through the final
--                 costs exactly one pick-slot per round — the same ceiling
--                 for every player, regardless of seeding or section. A
--                 first-round bye removes one opportunity: nothing was ever
--                 decided for that slot, since BracketPredictor doesn't ask
--                 for a pick when only one side of a match is real (058's
--                 isByeMatch — the auto-advancing player needs no prediction).
--
-- Computed purely from draw *structure* (draws.bracket_data), not from actual
-- results: opportunities reflects what the bracket allowed at prediction
-- time, before anything was known. This is the same reasoning 057's own
-- comment already relies on for the picks side ("backing someone deep counts
-- once per round... because a bracket is filled in before anyone plays") —
-- opportunities is just that same ceiling made explicit, for every entrant,
-- not only the ones this user actually picked.
--
-- Known limitation: if a player entered via a resolved qualifier slot, and
-- the tournament's stored bracket_data still shows the qualifier placeholder
-- id (see qualifier-remap.ts) rather than the resolved player's real
-- external_id, that tournament's rounds won't be counted for this player's
-- opportunities — an undercount, not an overcount, and it only affects the
-- rare case of a qualifier who advances into the main draw.
--
-- Cost is bounded by how many tournaments this one user entered (same
-- argument as 057/058), not by the user base.
--
-- Adding a column to RETURNS TABLE is not a body-only change — Postgres
-- rejects CREATE OR REPLACE FUNCTION the moment the OUT-parameter list
-- differs, the same wall 060 hit renaming a column. Drop first, exactly
-- like 060.
drop function if exists public.user_player_stats(uuid, int);

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
  ),
  -- One row per tournament this user entered, with that draw's matches.
  tournament_draws as (
    select pr.tournament_id, d.bracket_data
    from preds pr
    join public.draws d on d.tournament_id = pr.tournament_id
  ),
  -- The first round present in each draw. Draws are always contiguous from
  -- their first round through the final (see the admin draw builder), so
  -- this alone determines the draw's total round-depth.
  draw_rounds as (
    select
      td.tournament_id,
      min(round_ordinal(m ->> 'round')) as first_round_ord
    from tournament_draws td, lateral jsonb_array_elements(td.bracket_data -> 'matches') m
    group by td.tournament_id
  ),
  -- Every player who appears in the first round of a tournament's draw —
  -- whether the user ever picked them or not — with whether their slot was a
  -- bye. `->` (not `->>`) plus jsonb_typeof is required here: a JSON `null`
  -- value is not a SQL NULL, so `m -> 'player1' IS NULL` would silently
  -- always be false for a real bye slot.
  first_round_entrants as (
    select
      td.tournament_id,
      coalesce(m -> 'player1' ->> 'externalId', m -> 'player2' ->> 'externalId') as ext_id,
      (jsonb_typeof(m -> 'player1') = 'null') <> (jsonb_typeof(m -> 'player2') = 'null') as is_bye
    from tournament_draws td
    join draw_rounds dr on dr.tournament_id = td.tournament_id
    cross join lateral jsonb_array_elements(td.bracket_data -> 'matches') m
    where round_ordinal(m ->> 'round') = dr.first_round_ord
  ),
  opportunities as (
    select
      fre.ext_id,
      -- total rounds in the draw (F is always ordinal 7) minus one if this
      -- player's own first-round slot was a bye.
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
    coalesce(o.opportunities, 0)    as opportunities
  from picked pk
  left join earned e        on e.ext_id = pk.ext_id
  left join opportunities o on o.ext_id = pk.ext_id
  -- Names come from the registry rather than a draw snapshot: an all-time view
  -- spans many draws, and the registry is the one place that has every player.
  left join public.players pl on pl.external_id = pk.ext_id
  order by coalesce(e.points, 0) desc, pk.picks desc
  limit greatest(p_limit, 1);
$$;

-- The drop above wipes the prior grants too — reassert them.
revoke all on function public.user_player_stats(uuid, int) from public, anon, authenticated;
grant execute on function public.user_player_stats(uuid, int) to service_role;
