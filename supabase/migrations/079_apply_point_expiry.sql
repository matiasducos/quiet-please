-- Migration: 079_apply_point_expiry
-- Description: Makes the rolling 52-week ranking window actually expire.
--
-- The window has been stamped but never applied. `predictions.expires_at` is
-- written correctly by the award-points cron, and `recalculate_ranking_points`
-- filters on it — but that function only ever runs for users who earned points
-- in that same cron run. A user who stops playing is never recalculated, so
-- their `users.ranking_points` is frozen at its last value forever and the
-- window is enforced only against people still active. `league_members.total_points`
-- has the identical freeze: migration 032's window predicate is correct but only
-- evaluates when something calls it.
--
-- This migration adds the missing time-driven half:
--   A. predictions.expiry_applied_at — the marker that makes a sweep idempotent
--      and its work set O(expiring today) rather than O(all users)
--   B. apply_point_expiry() — one set-based sweep, called daily by the
--      /api/cron/expire-points route
--   C. recalculate_ranking_points() — extended to also maintain an all-time
--      total, revived on the long-dead users.total_points column
--
-- NOTHING IS EVER DELETED. point_ledger is untouched and predictions.points_earned
-- is untouched. Expiry changes only the derived aggregate columns on users and
-- league_members. Every historical tournament's points remain readable forever.
-- The verification harness (scripts/verify-point-expiry.mjs) asserts this as an
-- invariant on every run.

-- ============================================================
-- A. Marker column
-- ============================================================

alter table public.predictions
  add column if not exists expiry_applied_at timestamptz;

comment on column public.predictions.expiry_applied_at is
  'When a sweep last applied this row''s expiry to the derived ranking columns. '
  'NULL = still pending. Set by apply_point_expiry(). Must be cleared if '
  'expires_at is ever moved later, so the points can come back.';

-- Partial index: only rows still awaiting a sweep. Every prediction eventually
-- leaves this index and never returns, so it stays small no matter how large
-- the predictions table grows.
create index if not exists idx_predictions_pending_expiry
  on public.predictions (expires_at)
  where expiry_applied_at is null;

-- ============================================================
-- B. apply_point_expiry
-- ============================================================
--
-- Set-based on purpose. The obvious implementation — loop the expiring users and
-- call recalculate_ranking_points() per user, the way award-points does — does
-- not scale here. Expiries arrive in TOURNAMENT-SIZED BATCHES: everyone who
-- entered the event that started 364 days ago expires on the same day. At 10k
-- users a Slam is thousands of users times their league memberships, against a
-- 60s function limit. A timeout mid-loop leaves the leaderboard half-decayed.
-- One statement per table does the same work in a single round trip.
--
-- p_as_of   — "now", as an argument. This is what makes the function testable:
--             nothing in prod expires until 2027-03-29, so correctness cannot be
--             established by running it and looking. Dry-running with a future
--             p_as_of shows the real post-Roland-Garros board today.
-- p_dry_run — compute and report, write nothing.
-- p_limit   — batch ceiling. The caller loops until predictions_marked = 0, so a
--             very large sweep drains across calls instead of timing out; the
--             marker makes resuming free.

create or replace function public.apply_point_expiry(
  p_as_of   timestamptz default now(),
  p_dry_run boolean     default false,
  p_limit   int         default 5000
)
returns table (
  users_updated      int,
  predictions_marked int,
  sample             jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _pred_ids uuid[];
  _user_ids uuid[];
  _users_updated int := 0;
  _preds_marked  int := 0;
  _sample jsonb;
begin
  -- ── 1. The batch ────────────────────────────────────────────────────────
  -- Global (challenge_id is null) scoring predictions whose expiry has passed
  -- and which no sweep has applied yet. challenge_id is load-bearing: challenge
  -- brackets never count toward profile-level figures.
  select array_agg(b.id), array_agg(distinct b.user_id)
    into _pred_ids, _user_ids
  from (
    select p.id, p.user_id
    from public.predictions p
    where p.expires_at is not null
      and p.expires_at < p_as_of
      and p.expiry_applied_at is null
      and p.challenge_id is null
      and p.points_earned > 0
    order by p.expires_at
    limit p_limit
  ) b;

  if _pred_ids is null then
    return query select 0, 0, '[]'::jsonb;
    return;
  end if;

  _preds_marked := array_length(_pred_ids, 1);

  -- ── 2. Recompute the rolling columns for the affected users ─────────────
  -- LEFT JOIN + coalesce is load-bearing. A user whose only scoring prediction
  -- just expired has NO surviving rows to aggregate; an inner join would drop
  -- them from the result set entirely and leave their stale total in place.
  -- They must land on exactly 0.
  --
  -- total_points is deliberately NOT touched here — it is the all-time figure
  -- (section C) and by definition does not change when something expires.
  -- `on commit drop` handles the normal case (one call per transaction, which is
  -- how PostgREST invokes it). The explicit drop covers a caller that invokes
  -- the function twice inside one transaction — a test harness, or a future
  -- batching loop that wraps calls in a BEGIN.
  drop table if exists _expiry_agg;
  create temporary table _expiry_agg on commit drop as
  select u.user_id,
         coalesce(sum(p.points_earned), 0)::int as total,
         coalesce(sum(case when t.tour = 'ATP' then p.points_earned else 0 end), 0)::int as atp,
         coalesce(sum(case when t.tour = 'WTA' then p.points_earned else 0 end), 0)::int as wta
  from unnest(_user_ids) as u(user_id)
  left join public.predictions p
         on p.user_id      = u.user_id
        and p.challenge_id is null
        and p.points_earned > 0
        and (p.expires_at is null or p.expires_at > p_as_of)
  left join public.tournaments t
         on t.id = p.tournament_id
  group by u.user_id;

  -- Count and sample BEFORE writing, so the dry-run and the real run report
  -- identical numbers for the same p_as_of.
  select count(*)::int
    into _users_updated
  from _expiry_agg a
  join public.users us on us.id = a.user_id
  where us.ranking_points is distinct from a.total;

  select jsonb_agg(s)
    into _sample
  from (
    select a.user_id,
           us.username,
           us.ranking_points as points_before,
           a.total           as points_after
    from _expiry_agg a
    join public.users us on us.id = a.user_id
    where us.ranking_points is distinct from a.total
    order by (us.ranking_points - a.total) desc
    limit 10
  ) s;

  if p_dry_run then
    return query select _users_updated, _preds_marked, coalesce(_sample, '[]'::jsonb);
    return;
  end if;

  -- ── 3. Users ────────────────────────────────────────────────────────────
  update public.users u
  set ranking_points     = a.total,
      atp_ranking_points = a.atp,
      wta_ranking_points = a.wta
  from _expiry_agg a
  where u.id = a.user_id;

  -- ── 4. Leagues ──────────────────────────────────────────────────────────
  -- The predicate below is copied verbatim from migration 032
  -- (recalculate_member_points). Keep the two in sync — if the league window or
  -- its filters change there, change them here too.
  --
  -- NOTE a real divergence, deliberately preserved rather than fixed here:
  -- leagues window on `t.starts_at >= now() - 52 weeks`, while rankings window on
  -- `predictions.expires_at`. Those are the same rule today only because
  -- expires_at is starts_at + 364 days. They come apart under edition-based
  -- expiry (plan §10). Changing league semantics is out of scope for this
  -- migration — doing it here would be a silent behaviour change to every
  -- league standing.
  update public.league_members lm
  set total_points = coalesce((
    select sum(p.points_earned)
    from public.predictions p
    join public.tournaments t on t.id = p.tournament_id
    join public.leagues l     on l.id = lm.league_id
    where p.user_id      = lm.user_id
      and p.challenge_id is null
      and p.points_earned > 0
      and (l.allowed_tournament_types is null or t.category = any(l.allowed_tournament_types))
      and (l.allowed_surfaces         is null or t.surface  = any(l.allowed_surfaces))
      and t.starts_at >= greatest(
            coalesce(l.season_start_date, l.created_at),
            p_as_of - interval '52 weeks'
          )
  ), 0)
  where lm.user_id = any(_user_ids);

  -- ── 5. Mark the batch applied ───────────────────────────────────────────
  -- Last, so a failure anywhere above leaves the rows pending and the next run
  -- retries them rather than silently skipping a day.
  update public.predictions p
  set expiry_applied_at = p_as_of
  where p.id = any(_pred_ids);

  return query select _users_updated, _preds_marked, coalesce(_sample, '[]'::jsonb);
end;
$$;

-- Session-less context (cron). service_role only, per the convention for these
-- functions — call it with the admin client.
revoke all on function public.apply_point_expiry(timestamptz, boolean, int) from public, anon, authenticated;
grant execute on function public.apply_point_expiry(timestamptz, boolean, int) to service_role;

-- ============================================================
-- C. recalculate_ranking_points — add the all-time total
-- ============================================================
--
-- Replaces the version from migration 015. The three rolling columns keep
-- EXACTLY the semantics they had (global predictions only, positive points,
-- unexpired); the expiry test simply moves from WHERE to a FILTER clause so the
-- all-time figure can be computed in the same pass.
--
-- users.total_points has been dead since migration 007 zeroed it — nothing in
-- the app writes it except the admin-only test-tournaments sandbox, so it reads
-- 0 for every real user while still being selected on the profile page. It is
-- revived here as the all-time total, which is what its name always implied.
-- Every existing caller of this function now maintains it for free.
--
-- Why an all-time column is needed at all: once expiry works, a user's rolling
-- total can go to 0 while their history is intact. The points must stay
-- inspectable — this is the O(1) read path for that.

create or replace function public.recalculate_ranking_points(p_user_id uuid)
returns void language plpgsql security definer as $$
declare
  _total   integer;
  _atp     integer;
  _wta     integer;
  _alltime integer;
begin
  select
    coalesce(sum(p.points_earned)
      filter (where p.expires_at is null or p.expires_at > now()), 0),
    coalesce(sum(case when t.tour = 'ATP' then p.points_earned else 0 end)
      filter (where p.expires_at is null or p.expires_at > now()), 0),
    coalesce(sum(case when t.tour = 'WTA' then p.points_earned else 0 end)
      filter (where p.expires_at is null or p.expires_at > now()), 0),
    coalesce(sum(p.points_earned), 0)
  into _total, _atp, _wta, _alltime
  from public.predictions p
  join public.tournaments t on t.id = p.tournament_id
  where p.user_id       = p_user_id
    and p.challenge_id  is null
    and p.points_earned > 0;

  update public.users
  set ranking_points     = _total,
      atp_ranking_points = _atp,
      wta_ranking_points = _wta,
      total_points       = _alltime
  where id = p_user_id;
end;
$$;

-- ── Backfill total_points for every user ────────────────────────────────────
update public.users u
set total_points = coalesce(agg.t, 0)
from (
  select p.user_id, sum(p.points_earned)::int as t
  from public.predictions p
  where p.challenge_id is null
    and p.points_earned > 0
  group by p.user_id
) agg
where u.id = agg.user_id
  and u.total_points is distinct from coalesce(agg.t, 0);

-- Users with no scoring predictions: NOT EXISTS rather than NOT IN, which would
-- return no rows at all if the subquery ever yielded a NULL.
update public.users u
set total_points = 0
where u.total_points <> 0
  and not exists (
    select 1 from public.predictions p
    where p.user_id = u.id
      and p.challenge_id is null
      and p.points_earned > 0
  );
