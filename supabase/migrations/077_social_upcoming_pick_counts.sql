-- Migration: 077_social_upcoming_pick_counts
-- Backs the "68% of brackets have Sinner" line on the admin "Up next" card.
--
-- 074 answers the same question for matches that have been PLAYED, by counting
-- point_ledger rows per match_result_id. It cannot answer it here: a ledger row
-- is written when a pick scores, so a match nobody has played yet has no rows at
-- all. The only record of what the field thinks about a future match is the
-- bracket itself — predictions.picks, a jsonb object keyed by the draw's
-- matchId — so this reads there instead.
--
-- SQL rather than PostgREST for the same reason as 074: PostgREST cannot
-- aggregate, so it would have to return one row per (bracket, match) and count
-- them in Node, which hits the 1000-row cap and silently plateaus.
--
-- Returns a row per (match, picked player) rather than a single favourite. The
-- caller needs the losing side's count too, because the DENOMINATOR for this
-- card is the brackets that picked *this match*, not the tournament's bracket
-- count. Those two numbers diverge hard: most brackets are abandoned after round
-- one, so a quarterfinal can have 40 picks in a tournament with 1,200 entries,
-- and "3% have Sinner" would be a statement about attrition, not about belief.
-- Summing this function's rows for a match gives the honest denominator.

create or replace function public.social_upcoming_pick_counts(
  t_id   uuid,
  m_ids  text[]
)
returns table (
  external_match_id text,
  picked_id         text,
  pick_count        bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.key    as external_match_id,
    e.value  as picked_id,
    -- count(*) is already a distinct count of brackets: jsonb objects cannot
    -- hold a duplicate key, so a prediction contributes at most one row per
    -- match. No distinct needed, unlike 074 over point_ledger.
    count(*) as pick_count
  from public.predictions p
  -- `?|` is evaluated against p alone, so the planner applies it at the scan and
  -- brackets with no pick in this round never reach the expansion below. That is
  -- the common case in later rounds and it is what keeps this from being O(picks
  -- in the tournament) on every render. If it ever needs more, the operator is
  -- GIN-indexable: `create index on predictions using gin (picks)` — default
  -- jsonb_ops, NOT jsonb_path_ops, which does not support key-existence.
  cross join lateral jsonb_each_text(p.picks) as e(key, value)
  where p.tournament_id = t_id
    -- Same scoping as 074 and 076. A user in three challenges carries four
    -- brackets for the same match, and counting them would push a share past
    -- 100% as challenges get popular.
    and p.challenge_id is null
    and p.picks ?| m_ids
    and e.key = any(m_ids)
    -- Picks placed after the admin locked the match. They score zero and 076
    -- excludes them from accuracy; excluding them here keeps the card and the
    -- recap telling the same story about the same bracket.
    and not (coalesce(p.locked_picks, '[]'::jsonb) @> to_jsonb(e.key))
  group by e.key, e.value
$$;

-- Admin-only surface: called with the service-role client, never from a session.
-- A session-scoped caller could otherwise read the whole field's picks for a
-- match that has not been played, which is the one thing a bracket game has to
-- keep private.
revoke all on function public.social_upcoming_pick_counts(uuid, text[]) from public, anon, authenticated;
grant execute on function public.social_upcoming_pick_counts(uuid, text[]) to service_role;

comment on function public.social_upcoming_pick_counts(uuid, text[]) is
  'Global-bracket picks per (upcoming match, player), for the admin "Up next" social card. Excludes challenge brackets and post-lock picks.';
