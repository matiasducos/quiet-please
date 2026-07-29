-- Migration: 059_revoke_false_perfect_predictions
-- Removes The Perfect Prediction awards that were never actually earned.
--
-- The award condition compared a count of the user's point_ledger rows against
-- the tournament's match count. Neither side was right:
--
--   numerator   — point_ledger holds a row per (match, prediction), and a
--                 friends challenge is a separate full bracket. Summing a
--                 user's rows therefore added a whole bracket's worth of
--                 correct picks for every challenge they entered. One user's
--                 four Wimbledon brackets summed to 260 against a bar of 127,
--                 clearing it at 49% accuracy.
--   denominator — counted every result with a winner, including BYEs, which
--                 are never picked and can never score. Every 250-level event
--                 asked for 31 correct out of 27 that were possible.
--
-- The two errors pulled in opposite directions, so the achievement fired for
-- the wrong people rather than never firing at all. All 7 awards granted to
-- date are false positives; the best genuine result was 81 of 127.
--
-- This deletes by re-testing the corrected condition rather than by id, so it
-- removes exactly what does not qualify and leaves anything genuine intact.
-- Re-running is safe: a second run finds nothing left to delete.

with scoreable as (
  -- Matches that could actually be predicted and scored, per tournament.
  select
    mr.tournament_id,
    mr.external_match_id,
    mr.winner_external_id
  from public.match_results mr
  where mr.score is distinct from 'BYE'
    and mr.winner_external_id is not null
),
verdict as (
  select
    ua.id,
    count(s.external_match_id) filter (
      where not (coalesce(p.locked_picks, '[]'::jsonb) @> to_jsonb(s.external_match_id))
    ) as callable,
    count(s.external_match_id) filter (
      where not (coalesce(p.locked_picks, '[]'::jsonb) @> to_jsonb(s.external_match_id))
        and p.picks ->> s.external_match_id = s.winner_external_id
    ) as correct
  from public.user_achievements ua
  -- The user's own bracket only. Challenge brackets are excluded on purpose:
  -- they affect neither ranking nor leagues, so they should not earn a trophy.
  left join public.predictions p
    on p.user_id       = ua.user_id
   and p.tournament_id = ua.tournament_id
   and p.challenge_id is null
  left join scoreable s
    on s.tournament_id = ua.tournament_id
  where ua.achievement_key = 'perfect_prediction'
  group by ua.id
)
delete from public.user_achievements ua
using verdict v
where ua.id = v.id
  and (v.callable = 0 or v.correct < v.callable);
