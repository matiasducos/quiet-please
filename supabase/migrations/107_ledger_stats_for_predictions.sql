-- Migration: 107_ledger_stats_for_predictions
-- ACCURACY and STREAK POWER for a set of brackets, aggregated in Postgres.
--
-- Both tournament boards — /leaderboard/tournaments/<id> and
-- /leagues/<id>/tournaments/<id> — derived those two columns by pulling every
-- scoring point_ledger row for every bracket on the page and counting in JS.
-- PostgREST answers with at most 1000 rows and reports no error when it
-- truncates, so the boards were silently reading a prefix of the ledger.
--
-- The US Open 2026 board needs 2352 rows to render its first page of 50; it
-- was getting 1000. Because rows come back in insertion order and insertion
-- order is round order, the 1352 it dropped were the late rounds — exactly the
-- rows that carry a streak multiplier above 1. Every entrant on the page read
-- 1.0x, and the leader's accuracy read 28/127 against a true 70/127. The same
-- board inside a four-member league stayed correct only because four brackets
-- fit under the cap.
--
-- The season board (src/app/leaderboard/page.tsx) already worked around this by
-- paging the ledger client-side. That is correct but it moves thousands of rows
-- across the wire to produce one number per user, and it grows with the ledger.
-- Aggregating here is O(1) round trips and returns one row per user instead.
--
-- Definitions, which must match the season board's or the same user's STREAK
-- POWER would differ between two pages that sit one click apart:
--   correct_picks — scoring ledger rows (points > 0). A ledger row proves a
--                   pick was right; its absence proves nothing, since a
--                   250-level R64 pays zero. `points > 0` is what the boards
--                   have always counted, and it is the only thing that can be
--                   counted here.
--   total_points  — points as awarded, multiplier included.
--   base_points   — the same points with the multiplier divided back out.
-- STREAK POWER is total_points / base_points: a points-weighted mean
-- multiplier, so a big late-round win moves it more than an early one.
--
-- Scoped by prediction id rather than by tournament and user, because that is
-- what both callers already hold and it keeps challenge brackets out by
-- construction — the caller's prediction query filters challenge_id is null,
-- and challenge points must never reach a leaderboard.

create or replace function public.ledger_stats_for_predictions(pred_ids uuid[])
returns table (
  user_id       uuid,
  correct_picks bigint,
  total_points  numeric,
  base_points   numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.user_id,
    count(*)          as correct_picks,
    sum(l.points)::numeric as total_points,
    -- nullif guards a stored 0: dividing by it would raise, and a row that
    -- claims a zero multiplier is a scoring bug, not a reason to 500 a board.
    sum(l.points::numeric / coalesce(nullif(l.streak_multiplier, 0), 1)) as base_points
  from public.point_ledger l
  where l.prediction_id = any(pred_ids)
    and l.points > 0
  group by l.user_id;
$$;

-- Admin-only, like 057/058/062: this reads other users' scoring history, and
-- both callers already use the service-role client.
revoke all on function public.ledger_stats_for_predictions(uuid[]) from public, anon, authenticated;
grant execute on function public.ledger_stats_for_predictions(uuid[]) to service_role;

-- No new index. `prediction_id = any(...)` is served by
-- idx_point_ledger_prediction_id (015, re-asserted in 039 and 057), and the
-- points > 0 predicate is a filter over the rows that index already found.
