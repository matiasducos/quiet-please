-- Migration: 061_reconcile_accuracy_achievements
-- Recomputes the four "correct picks in a single tournament" badges against
-- what users actually did, granting what was earned and revoking what was not.
--
-- Two faults, pulling in opposite directions:
--
--   too easy  — the award counted point_ledger rows, which hold one row per
--               (match, prediction). A friends challenge is a separate full
--               bracket, so entering challenges added a whole bracket's worth
--               of correct picks. Nine badges were granted to users who never
--               reached the threshold on their own bracket.
--
--   too hard  — the guard listing which keys still needed checking omitted
--               double_digits, so once a user held the other three the block
--               short-circuited and that badge could never be granted. It also
--               only ever ran for the tournament being scored, so reaching a
--               threshold before a badge existed never granted it in
--               retrospect. Roughly ninety earned badges were never awarded.
--
-- Correct picks here means: the user's own bracket, over played non-BYE matches
-- they were not locked out of — the same basis as checkPerfectPrediction and
-- countCorrectPicks. Challenge brackets are excluded deliberately; they affect
-- neither ranking nor leagues and should not earn profile badges.
--
-- Re-running is safe: it converges on the same set.

with scoreable as (
  select
    mr.tournament_id,
    mr.external_match_id,
    mr.winner_external_id
  from public.match_results mr
  where mr.score is distinct from 'BYE'
    and mr.winner_external_id is not null
),
-- Correct picks per (user, tournament), from their own bracket only.
per_tournament as (
  select
    p.user_id,
    p.tournament_id,
    count(*) filter (
      where not (coalesce(p.locked_picks, '[]'::jsonb) @> to_jsonb(s.external_match_id))
        and p.picks ->> s.external_match_id = s.winner_external_id
    ) as correct
  from public.predictions p
  join scoreable s on s.tournament_id = p.tournament_id
  where p.challenge_id is null
  group by p.user_id, p.tournament_id
),
-- Best single-tournament result per user — these badges are "in a single
-- tournament", so the maximum is what qualifies, not the sum.
best as (
  select user_id, max(correct) as best_correct
  from per_tournament
  group by user_id
),
thresholds(key, min_correct) as (
  values ('sharp_eye', 5), ('double_digits', 10), ('on_fire', 15), ('crystal_ball', 25)
),
-- What every user should hold.
should_hold as (
  select b.user_id, t.key
  from best b
  join thresholds t on b.best_correct >= t.min_correct
)
-- Revoke what was never earned.
delete from public.user_achievements ua
where ua.achievement_key in ('sharp_eye', 'double_digits', 'on_fire', 'crystal_ball')
  and not exists (
    select 1 from should_hold sh
    where sh.user_id = ua.user_id
      and sh.key     = ua.achievement_key
  );

-- Grant what was earned but never awarded. Same CTE chain: a single statement
-- cannot both delete and insert, and recomputing keeps the two consistent.
with scoreable as (
  select
    mr.tournament_id,
    mr.external_match_id,
    mr.winner_external_id
  from public.match_results mr
  where mr.score is distinct from 'BYE'
    and mr.winner_external_id is not null
),
per_tournament as (
  select
    p.user_id,
    p.tournament_id,
    count(*) filter (
      where not (coalesce(p.locked_picks, '[]'::jsonb) @> to_jsonb(s.external_match_id))
        and p.picks ->> s.external_match_id = s.winner_external_id
    ) as correct
  from public.predictions p
  join scoreable s on s.tournament_id = p.tournament_id
  where p.challenge_id is null
  group by p.user_id, p.tournament_id
),
best as (
  select user_id, max(correct) as best_correct
  from per_tournament
  group by user_id
),
thresholds(key, min_correct) as (
  values ('sharp_eye', 5), ('double_digits', 10), ('on_fire', 15), ('crystal_ball', 25)
)
insert into public.user_achievements (user_id, achievement_key, tournament_id, meta)
select b.user_id, t.key, null, '{}'::jsonb
from best b
join thresholds t on b.best_correct >= t.min_correct
where not exists (
  select 1 from public.user_achievements ua
  where ua.user_id         = b.user_id
    and ua.achievement_key = t.key
    and ua.tournament_id is null
);
