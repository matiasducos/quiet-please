-- Migration: 090_tournament_complete_emails
-- Description: Tell every participant, by email and in-app, that a tournament
--              they played is over — and point them at the recap.
--
-- The gap this closes: at completion, a signed-in participant received nothing
-- that said the tournament had ended. They got a "+380 pts" mail from the
-- scoring run (which reads as a mid-tournament update, because that is exactly
-- what it is the other 95% of the time), and, if they podiumed, an achievement
-- mail. Everyone else — the majority — was never told the event finished or
-- that a recap of it exists. The only completion mail in the codebase went to
-- ANONYMOUS players (award-points steps 12b/12c), which is the wrong way round:
-- the people with accounts are the ones worth bringing back.
--
-- Three pieces here:
--   A. predictions.result_emailed_at — the per-bracket send guard
--   B. the 'tournament_completed' notification type
--   C. tournament_result_email_batch() — the pending batch, ranked in SQL

-- ============================================================
-- A. The send guard
-- ============================================================
--
-- Per PREDICTION, not per tournament. A single tournaments.results_emailed_at
-- would be one write and O(1), but it is claimed all-or-nothing: a Resend blip
-- halfway through the fan-out either loses the rest of the recipients forever
-- (claim first) or re-mails the ones already sent (claim last). Per-bracket is
-- the same self-healing shape as challenges.creator_result_emailed_at (078) and
-- anonymous_predictions.result_emailed_at (085) — stamp after the send returns,
-- and a failure simply leaves the row pending for the next run.

alter table public.predictions
  add column if not exists result_emailed_at timestamptz;

comment on column public.predictions.result_emailed_at is
  'When the tournament-completed email was sent for this bracket. NULL = still pending. '
  'Stamped only after the send returns, so a failed send is retried by the next award-points run. '
  'Also stamped without a send for bot accounts, to retire them from the pending set.';

-- ── Backfill: history is treated as already mailed ──────────────────────────
--
-- THE most important statement in this migration. Without it, the first
-- award-points run after this ships finds every prediction ever made in an
-- already-completed tournament sitting at result_emailed_at IS NULL, and mails
-- every user about every tournament they have played going back to Marrakech in
-- April. There is no undo on a send.
--
-- now() rather than the tournament's completion time because this column means
-- "we are done mailing this bracket", and we are — by deciding not to. Nothing
-- reads the value except the IS NULL check.

update public.predictions p
set result_emailed_at = now()
from public.tournaments t
where t.id = p.tournament_id
  and t.status = 'completed'
  and p.challenge_id is null
  and p.result_emailed_at is null;

-- Partial index on the pending set. The filter below is
-- (tournament_id, result_emailed_at is null, challenge_id is null); indexing
-- only the pending rows keeps this small as the table grows, and it shrinks
-- with every tournament that finishes mailing rather than growing forever.
create index if not exists predictions_result_email_pending
  on public.predictions (tournament_id)
  where result_emailed_at is null and challenge_id is null;

-- ============================================================
-- B. The notification type
-- ============================================================
--
-- Postgres has no ADD VALUE for a CHECK ... IN, so the full list has to be
-- re-declared. Copied forward from 080_points_expired_notification.sql — if you
-- add a type, copy this whole list again rather than writing a partial one.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'draw_open',
    'points_awarded',
    'points_expired',
    'tournament_completed',
    'challenge_received',
    'challenge_cancelled',
    'challenge_picks_locked',
    'friend_request',
    'friend_accepted',
    'friend_picks_locked',
    'league_member_joined',
    'league_member_left',
    'league_deleted',
    'league_ownership_transferred',
    'auto_predictions_generated',
    'achievement_earned',
    'referral_joined'
  ));

-- ============================================================
-- C. The pending batch
-- ============================================================
--
-- Returns the participants of one tournament who have not been mailed yet,
-- each carrying the finishing position the email quotes.
--
-- The rank is computed HERE rather than in the route for the reason CLAUDE.md
-- gives: the alternative is pulling every bracket in the tournament into the
-- serverless function to sort it in memory, which is fine at today's ~90
-- entrants and is not fine at 10k. The window function ranks inside Postgres
-- and the LIMIT applies after, so the route receives one batch-sized page no
-- matter how large the field is.
--
-- Two subtleties in the ranking:
--
--   * Ranked over EVERY global bracket in the tournament, then filtered to the
--     unmailed ones. Ranking after the filter would renumber the field on every
--     pass — the second run would tell someone they finished 4th when the first
--     run had already told the three people above them they finished 4th, 5th
--     and 6th. `total` is the whole field for the same reason.
--
--   * rank(), not row_number(): ties are real and common (most brackets score
--     the same small number of points), and row_number would break them
--     arbitrarily, so the same bracket could be told a different position
--     depending on which run happened to pick it up.
--
-- Bots are NOT excluded here. The route skips the send for them but still
-- stamps result_emailed_at, which retires them from the pending set; filtering
-- them out in SQL would leave them unstamped and rescanned on every future run,
-- forever, and at 87 bots per 91 entrants that is almost the whole set.

create or replace function public.tournament_result_email_batch(
  p_tournament_id uuid,
  p_limit int default 200
)
returns table (
  prediction_id  uuid,
  user_id        uuid,
  username       text,
  email          text,
  points         int,
  finish_rank    int,
  field_size     int,
  email_notifications boolean,
  email_preferences   jsonb,
  unsubscribe_token   uuid
)
language sql
stable
as $$
  with field as (
    select
      p.id,
      p.user_id,
      coalesce(p.points_earned, 0)                                        as points,
      rank() over (order by coalesce(p.points_earned, 0) desc)::int       as finish_rank,
      count(*) over ()::int                                               as field_size,
      p.result_emailed_at
    from public.predictions p
    where p.tournament_id = p_tournament_id
      and p.challenge_id is null
  )
  select
    f.id,
    f.user_id,
    u.username,
    u.email,
    f.points,
    f.finish_rank,
    f.field_size,
    u.email_notifications,
    u.email_preferences,
    u.unsubscribe_token
  from field f
  join public.users u on u.id = f.user_id
  where f.result_emailed_at is null
  order by f.finish_rank
  limit p_limit;
$$;

-- Service-role only. It returns every participant's email address, which no
-- signed-in user has any business reading — the award-points cron is the only
-- caller and it uses the admin client.
revoke all on function public.tournament_result_email_batch(uuid, int) from public, anon, authenticated;
grant execute on function public.tournament_result_email_batch(uuid, int) to service_role;

comment on function public.tournament_result_email_batch(uuid, int) is
  'Participants of a completed tournament still awaiting their result email, with finishing position. '
  'Ranked over the whole field before filtering, so positions stay stable across runs. Called by award-points.';
