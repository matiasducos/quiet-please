-- Migration: 081_edition_based_expiry
-- Description: Real ATP expiry semantics — points die when the next edition of
-- the same tournament is played, with 52 weeks as the fallback.
--
-- 079 made the window fire on a flat `starts_at + 364 days`. That is not the ATP
-- rule and it is genuinely wrong at the edges: tour dates move by a week or two
-- year to year, so a flat count makes a player hold BOTH editions for the overlap
-- (if the new one starts early) or NEITHER for a gap (if it starts late). The real
-- rule is the "defending points" mechanic — you carry last year's haul into the
-- event and swap it for this year's when the event is played. If the event is not
-- held again, the points expire at 52 weeks.
--
-- Migration 007's own header promised this ("when the same tournament runs next
-- year, expires_at is updated to the new edition's start") and it was never built.
--
-- Sections:
--   A. tournaments.completed_at + a TRIGGER to maintain it
--   B. recalculate_rolling_for_users() — helper extracted so the league window
--      predicate lives in exactly one place
--   C. refresh_point_expiry() — DERIVES expires_at, rather than stamping it
--   D. apply_point_expiry() — refactored onto the helper, behaviour unchanged
--
-- Still nothing is deleted. point_ledger and predictions.points_earned are never
-- touched; expiry only ever moves derived aggregates and the expires_at cache.

-- ============================================================
-- A. tournaments.completed_at
-- ============================================================
--
-- Branch 1 of the rule needs a real timestamp for "when was the new edition
-- played". No column existed.
--
-- Maintained by a TRIGGER rather than at the call sites on purpose: four
-- different places write status = 'completed' (the generic status setter,
-- award-points in two spots, sync-backfill), and completion is already an
-- overloaded trigger point — trophies, Perfect Prediction, challenge
-- finalization and invite expiry all hang off it. A fifth writer added later
-- would silently skip the stamp. The trigger also handles the un-complete path
-- the admin results page provides: dropping out of 'completed' clears the
-- timestamp, so a mistakenly-completed tournament cannot leave a phantom date
-- that retires last year's points early.

alter table public.tournaments
  add column if not exists completed_at timestamptz;

comment on column public.tournaments.completed_at is
  'When this edition was marked completed. Maintained by trigger, not by callers. '
  'Drives edition-based point expiry (refresh_point_expiry).';

create or replace function public.tournaments_stamp_completed_at()
returns trigger language plpgsql as $$
begin
  if NEW.status = 'completed'
     and (TG_OP = 'INSERT' or OLD.status is distinct from 'completed') then
    -- coalesce so an explicit backfill value survives
    NEW.completed_at := coalesce(NEW.completed_at, now());
  elsif NEW.status is distinct from 'completed' then
    NEW.completed_at := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_tournaments_completed_at on public.tournaments;
create trigger trg_tournaments_completed_at
  before insert or update of status on public.tournaments
  for each row execute function public.tournaments_stamp_completed_at();

-- Backfill: the last result we scored is the best available proxy for when an
-- already-completed edition actually finished. ends_at where nothing was scored.
update public.tournaments t
set completed_at = coalesce(
      (select max(mr.scored_at) from public.match_results mr where mr.tournament_id = t.id),
      t.ends_at
    )
where t.status = 'completed'
  and t.completed_at is null;

-- ============================================================
-- B. recalculate_rolling_for_users
-- ============================================================
--
-- Extracted from apply_point_expiry so that it and refresh_point_expiry share
-- one implementation. The league predicate in particular must not be copied a
-- third time — it is already duplicated between migration 032's two functions,
-- and a third copy would drift.

create or replace function public.recalculate_rolling_for_users(
  p_user_ids uuid[],
  p_as_of    timestamptz default now()
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  _changed int := 0;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  drop table if exists _roll_agg;
  -- LEFT JOIN + coalesce is load-bearing: a user whose only scoring prediction
  -- just expired has no surviving rows, and must land on 0 rather than being
  -- skipped and keeping a stale total.
  create temporary table _roll_agg on commit drop as
  select u.user_id,
         coalesce(sum(p.points_earned), 0)::int as total,
         coalesce(sum(case when t.tour = 'ATP' then p.points_earned else 0 end), 0)::int as atp,
         coalesce(sum(case when t.tour = 'WTA' then p.points_earned else 0 end), 0)::int as wta
  from unnest(p_user_ids) as u(user_id)
  left join public.predictions p
         on p.user_id       = u.user_id
        and p.challenge_id  is null
        and p.points_earned > 0
        and (p.expires_at is null or p.expires_at > p_as_of)
  left join public.tournaments t
         on t.id = p.tournament_id
  group by u.user_id;

  select count(*)::int into _changed
  from _roll_agg a join public.users us on us.id = a.user_id
  where us.ranking_points is distinct from a.total;

  update public.users u
  set ranking_points     = a.total,
      atp_ranking_points = a.atp,
      wta_ranking_points = a.wta
  from _roll_agg a
  where u.id = a.user_id;

  -- Predicate copied verbatim from migration 032 (recalculate_member_points).
  -- Keep in sync. Leagues window on t.starts_at rather than expires_at — a real
  -- divergence that widens under edition-based expiry, left alone deliberately
  -- because changing it would silently restate every league standing.
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
  where lm.user_id = any(p_user_ids);

  return _changed;
end;
$$;

-- ============================================================
-- C. refresh_point_expiry — derive, don't stamp
-- ============================================================
--
-- The obvious implementation of edition-based expiry is to re-stamp expires_at
-- when a new edition completes. DON'T. Imperative re-stamping makes every
-- calendar change a write that can be missed, and it needs bug-prone
-- compensations: a re-stamp that moves the date LATER has to resurrect points a
-- sweep already retired, and a re-stamp that never fires leaves a stale date
-- forever.
--
-- Deriving the value fresh each day removes that whole class of bug, and means a
-- cancelled or vanished tournament needs NO manual signal:
--
--   cancelled, never returns .......... no later edition row -> branch 3, 52 weeks
--   scheduled then deleted ............ derivation re-reads   -> branch 3
--   dropped, row left in 'upcoming' ... branch 2's cap fires
--   returns later than the anniversary  branch 2 greatest() extends the window
--   returns earlier ................... branch 1 swaps at completion
--   renamed / new sponsor ............. series identity is independent of name
--
-- For edition E, with next_ed = the earliest edition of the same
-- (series_id, tour) with a later starts_year:
--
--   1. next_ed.completed_at is not null -> that timestamp (the swap)
--   2. next_ed exists but unplayed      -> hold through it, capped
--   3. no next_ed                       -> starts_at + 364 days
--
-- The +60d cap in branch 2 is the safety valve: a phantom edition parked in
-- 'upcoming' forever would otherwise suppress expiry indefinitely. Worst case
-- for ANY unsignalled disappearance becomes "points live 60 days too long".

create or replace function public.refresh_point_expiry(
  p_as_of   timestamptz default now(),
  p_dry_run boolean     default false
)
returns table (
  rows_updated int,
  resurrected  int,
  newly_due    int,
  sample       jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _rows_updated int := 0;
  _resurrected  int := 0;
  _newly_due    int := 0;
  _sample jsonb;
  _touched uuid[];
begin
  drop table if exists _expiry_calc;
  create temporary table _expiry_calc on commit drop as
  with calc as (
    select p.id       as prediction_id,
           p.user_id,
           p.expires_at as old_expires,
           p.expiry_applied_at,
           t.name       as tournament_name,
           case
             when ne.completed_at is not null then ne.completed_at
             when ne.next_id is not null then least(
                    greatest(
                      t.starts_at + interval '364 days',
                      ne.ends_at  + interval '3 days'
                    ),
                    t.starts_at + interval '364 days' + interval '60 days'
                  )
             else t.starts_at + interval '364 days'
           end as new_expires
    from public.predictions p
    join public.tournaments t on t.id = p.tournament_id
    left join lateral (
      select n.id as next_id, n.completed_at, n.ends_at
      from public.tournaments n
      where n.series_id   = t.series_id
        and n.series_id  is not null
        and n.tour        = t.tour
        and n.starts_year > t.starts_year
      order by n.starts_year asc
      limit 1
    ) ne on true
    where p.challenge_id  is null
      and p.points_earned > 0
      and t.starts_at is not null
  )
  select *,
         (old_expires is not null and old_expires <= p_as_of) as was_expired,
         (new_expires <= p_as_of)                             as now_expired
  from calc
  where old_expires is distinct from new_expires;

  select count(*)::int into _rows_updated from _expiry_calc;
  if _rows_updated = 0 then
    return query select 0, 0, 0, '[]'::jsonb;
    return;
  end if;

  select count(*)::int into _resurrected from _expiry_calc where was_expired and not now_expired;
  select count(*)::int into _newly_due    from _expiry_calc where not was_expired and now_expired;

  select jsonb_agg(s) into _sample from (
    select tournament_name, old_expires, new_expires, was_expired, now_expired
    from _expiry_calc
    order by new_expires
    limit 10
  ) s;

  if p_dry_run then
    return query select _rows_updated, _resurrected, _newly_due, coalesce(_sample, '[]'::jsonb);
    return;
  end if;

  update public.predictions p
  set expires_at = c.new_expires,
      -- Clearing the marker when a row is no longer expired is what lets points
      -- come back. Leaving it set would make the row invisible to every future
      -- sweep and freeze the resurrection out permanently.
      expiry_applied_at = case when c.now_expired then p.expiry_applied_at else null end
  from _expiry_calc c
  where p.id = c.prediction_id;

  -- Anyone whose expired/live status flipped in EITHER direction now has stale
  -- totals: resurrected users are missing points, newly-due users are carrying
  -- points they should not. Recompute both.
  select array_agg(distinct user_id) into _touched
  from _expiry_calc
  where was_expired is distinct from now_expired;

  perform public.recalculate_rolling_for_users(_touched, p_as_of);

  return query select _rows_updated, _resurrected, _newly_due, coalesce(_sample, '[]'::jsonb);
end;
$$;

-- ============================================================
-- D. apply_point_expiry — refactored onto the shared helper
-- ============================================================
-- Behaviour is unchanged from 079; the inlined user/league updates are replaced
-- by the extracted helper so the league predicate exists once.

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

  -- Count and sample BEFORE writing, so dry and real runs report identically.
  drop table if exists _apply_preview;
  create temporary table _apply_preview on commit drop as
  select u.user_id,
         us.username,
         us.ranking_points as points_before,
         coalesce(sum(p.points_earned), 0)::int as points_after
  from unnest(_user_ids) as u(user_id)
  join public.users us on us.id = u.user_id
  left join public.predictions p
         on p.user_id       = u.user_id
        and p.challenge_id  is null
        and p.points_earned > 0
        and (p.expires_at is null or p.expires_at > p_as_of)
  group by u.user_id, us.username, us.ranking_points;

  select count(*)::int into _users_updated
  from _apply_preview where points_before is distinct from points_after;

  select jsonb_agg(s) into _sample from (
    select user_id, username, points_before, points_after
    from _apply_preview
    where points_before is distinct from points_after
    order by (points_before - points_after) desc
    limit 10
  ) s;

  if p_dry_run then
    return query select _users_updated, _preds_marked, coalesce(_sample, '[]'::jsonb);
    return;
  end if;

  perform public.recalculate_rolling_for_users(_user_ids, p_as_of);

  -- Marked last, so a failure above leaves the rows pending for the next run.
  update public.predictions p
  set expiry_applied_at = p_as_of
  where p.id = any(_pred_ids);

  return query select _users_updated, _preds_marked, coalesce(_sample, '[]'::jsonb);
end;
$$;

-- ── Grants: session-less contexts only ──────────────────────────────────────
revoke all on function public.recalculate_rolling_for_users(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.recalculate_rolling_for_users(uuid[], timestamptz) to service_role;

revoke all on function public.refresh_point_expiry(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.refresh_point_expiry(timestamptz, boolean) to service_role;

revoke all on function public.apply_point_expiry(timestamptz, boolean, int) from public, anon, authenticated;
grant execute on function public.apply_point_expiry(timestamptz, boolean, int) to service_role;
