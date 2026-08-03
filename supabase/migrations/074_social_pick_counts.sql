-- Migration: 074_social_pick_counts
-- Backs the "only 12% called it" line on the admin social cards.
--
-- The naive way to answer "how many players picked this winner" is to read every
-- predictions.picks jsonb for the tournament and count in Node. That is a full
-- scan of the table per card, and at 10k users it is also silently wrong:
-- PostgREST caps a response at 1000 rows, so the count would quietly plateau.
--
-- point_ledger already holds the answer. One row exists per correct pick per
-- match, indexed on match_result_id — so the numerator is a grouped count over
-- an index, independent of how many users the app has.
--
-- The join to predictions is not optional. point_ledger carries challenge
-- bracket rows alongside global ones, and a user who entered three challenges
-- contributes four rows for the same match. Without `challenge_id is null` the
-- percentage climbs past 100 as challenges get popular.
--
-- SQL rather than PostgREST because PostgREST cannot aggregate: it would have to
-- return one row per (user, match) and let the client count them, which is the
-- 1000-row cliff again.

create or replace function public.social_match_pick_counts(
  t_id   uuid,
  m_ids  uuid[]
)
returns table (
  match_result_id  uuid,
  correct_count    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pl.match_result_id,
    -- distinct is belt-and-braces: 028 made ledger writes idempotent per
    -- (prediction_id, match_result_id), but a re-run that predates it could
    -- have left a duplicate, and double-counting here inflates a public post.
    count(distinct pl.prediction_id) as correct_count
  from public.point_ledger pl
  join public.predictions p on p.id = pl.prediction_id
  where pl.tournament_id = t_id
    and pl.match_result_id = any(m_ids)
    and p.challenge_id is null
  group by pl.match_result_id
$$;

-- Admin-only surface: called with the service-role client, never from a session.
revoke all on function public.social_match_pick_counts(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.social_match_pick_counts(uuid, uuid[]) to service_role;

comment on function public.social_match_pick_counts(uuid, uuid[]) is
  'Correct global-prediction picks per match, for admin social cards. Excludes challenge brackets.';
