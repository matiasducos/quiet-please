-- Migration: 032_league_seasons_surfaces
-- Adds season reset and surface filtering to leagues.
--
-- season_start_date: only predictions from tournaments starting after this date
--   count toward standings. Owner can reset to now() to start a fresh season.
--   Combined with a 52-week rolling window (whichever boundary is more recent).
--
-- allowed_surfaces: optional surface filter for leagues (hard, clay, grass).
--   null = all surfaces count.

-- ── 1. New columns ──────────────────────────────────────────────────────────

alter table public.leagues
  add column if not exists season_start_date timestamptz default now(),
  add column if not exists allowed_surfaces text[];

-- Backfill existing leagues: season starts at league creation
update public.leagues set season_start_date = created_at where season_start_date is null;

-- ── 2. Update recalculate_league_points (global, called by cron) ────────────

create or replace function public.recalculate_league_points()
returns void
language plpgsql
security definer
as $$
begin
  update public.league_members lm
  set total_points = coalesce((
    select sum(p.points_earned)
    from public.predictions p
    join public.tournaments t on t.id = p.tournament_id
    join public.leagues l on l.id = lm.league_id
    where p.user_id = lm.user_id
      and p.challenge_id is null
      and p.points_earned > 0
      -- Tournament type filter
      and (
        l.allowed_tournament_types is null
        or t.category = any(l.allowed_tournament_types)
      )
      -- Surface filter
      and (
        l.allowed_surfaces is null
        or t.surface = any(l.allowed_surfaces)
      )
      -- Season boundary: GREATEST(season_start_date, now - 52 weeks)
      and t.starts_at >= greatest(
        coalesce(l.season_start_date, l.created_at),
        now() - interval '52 weeks'
      )
  ), 0);
end;
$$;

-- ── 3. Update recalculate_member_points (targeted, called on join/create) ───

create or replace function public.recalculate_member_points(
  p_league_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
as $$
begin
  update public.league_members lm
  set total_points = coalesce((
    select sum(p.points_earned)
    from public.predictions p
    join public.tournaments t on t.id = p.tournament_id
    join public.leagues l on l.id = lm.league_id
    where p.user_id = lm.user_id
      and p.challenge_id is null
      and p.points_earned > 0
      -- Tournament type filter
      and (
        l.allowed_tournament_types is null
        or t.category = any(l.allowed_tournament_types)
      )
      -- Surface filter
      and (
        l.allowed_surfaces is null
        or t.surface = any(l.allowed_surfaces)
      )
      -- Season boundary: GREATEST(season_start_date, now - 52 weeks)
      and t.starts_at >= greatest(
        coalesce(l.season_start_date, l.created_at),
        now() - interval '52 weeks'
      )
  ), 0)
  where lm.league_id = p_league_id
    and lm.user_id = p_user_id;
end;
$$;

-- ── 4. Recalculate all league points with new filters ───────────────────────

select public.recalculate_league_points();
