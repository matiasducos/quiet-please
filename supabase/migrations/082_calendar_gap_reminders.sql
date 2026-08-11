-- Migration: 082_calendar_gap_reminders
-- Description: Warns admins, in-app, when a tournament's points are about to
-- expire on the flat 52-week fallback because next year's edition has not been
-- loaded yet.
--
-- Edition-based expiry (081) is only as good as the calendar behind it. When no
-- later edition of a series exists, refresh_point_expiry falls to branch 3 and
-- retires the points at starts_at + 364 days. That is the correct ATP behaviour
-- for an event that genuinely is not held again — and exactly the wrong outcome
-- when the event IS happening and we simply have not entered it yet. The two
-- cases are indistinguishable from inside the database, so the only defence is
-- to tell a human in time.
--
-- Draws and results are entered by hand here, so "load next year's calendar" is
-- a real task somebody has to remember. This turns it into a reminder that
-- arrives on its own.

-- ============================================================
-- A. notifications CHECK — add 'admin_calendar_gap'
-- ============================================================
-- Full list re-declared (no ADD VALUE for CHECK ... IN). Copied forward from
-- 080; copy this whole list again next time rather than writing a partial one.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'draw_open',
    'points_awarded',
    'points_expired',
    'admin_calendar_gap',
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
-- B. calendar_gaps()
-- ============================================================
--
-- A "gap" is a scored edition whose flat 364-day expiry falls inside the warning
-- window AND which has no later edition of the same (series_id, tour). Matching
-- on tour as well as series is load-bearing: a series is deliberately
-- tour-agnostic (Wimbledon is one series with an ATP edition and a WTA edition),
-- so series alone would let an ATP entry silence a missing WTA one.
--
-- Only editions with points actually riding on them are reported — a tournament
-- nobody scored has nothing to lose by expiring.

create or replace function public.calendar_gaps(
  p_as_of       timestamptz default now(),
  p_within_days int         default 90
)
returns table (
  series_id            uuid,
  series_name          text,
  tour                 text,
  edition_year         int,
  flat_expiry          timestamptz,
  affected_predictions int
)
language sql
security definer
set search_path = public
as $$
  select t.series_id,
         coalesce(s.name, t.name)                as series_name,
         t.tour,
         t.starts_year                           as edition_year,
         t.starts_at + interval '364 days'       as flat_expiry,
         count(p.id)::int                        as affected_predictions
  from public.tournaments t
  join public.predictions p
    on p.tournament_id = t.id
   and p.challenge_id  is null
   and p.points_earned > 0
  left join public.tournament_series s on s.id = t.series_id
  where t.starts_at is not null
    and t.series_id is not null
    -- Anniversary lands inside the warning window
    and t.starts_at + interval '364 days' >= p_as_of
    and t.starts_at + interval '364 days' <  p_as_of + make_interval(days => p_within_days)
    -- ...and nothing newer exists to swap the points against
    and not exists (
      select 1 from public.tournaments n
      where n.series_id   = t.series_id
        and n.tour        = t.tour
        and n.starts_year > t.starts_year
    )
  group by t.series_id, s.name, t.name, t.tour, t.starts_year, t.starts_at
  order by flat_expiry asc;
$$;

revoke all on function public.calendar_gaps(timestamptz, int) from public, anon, authenticated;
grant execute on function public.calendar_gaps(timestamptz, int) to service_role;
