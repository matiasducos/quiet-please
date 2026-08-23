-- Migration: 089_admin_league_overview
-- Leagues with their member counts, for the admin overview at /admin/leagues.
--
-- Why this is a function rather than a PostgREST query:
--
-- A league's member count is an aggregate over `league_members`, and PostgREST
-- cannot GROUP BY. The two ways to get it from the client both break:
--
--   * one `head: true` count per league — 25 round trips per page, and it grows
--     with the page rather than staying flat;
--   * fetch the membership rows and count them in Node — capped at 1000 rows by
--     PostgREST, with no error when it truncates. That cap is not theoretical
--     here: on 2026-08-23 the largest league had 40 members, so a 25-league page
--     of leagues that size lands on exactly 1000 rows. The next member to join
--     would have started silently under-reporting every count on the page.
--
-- Doing it in SQL is one round trip and one pass, and the counts are exact.
--
-- Cost note: this is an admin survey page, so it is O(leagues) by definition —
-- its whole job is to describe every league. What it avoids is being O(members):
-- the counts are aggregated inside Postgres against the (league_id) index and
-- only one integer per league crosses the wire, so growing the user base grows
-- the aggregate, not the response.

-- ── One page of leagues, filtered, sorted and counted ────────────────────────
create or replace function public.admin_league_overview(
  p_search     text default null,
  -- 'all' | 'public' | 'private'
  p_visibility text default 'all',
  -- 'all' | 'active' | 'inactive'
  p_status     text default 'all',
  -- 'members' | 'newest' | 'name'
  p_sort       text default 'members',
  p_limit      int  default 25,
  p_offset     int  default 0
)
returns table (
  id                       uuid,
  name                     text,
  description              text,
  invite_code              text,
  is_public                boolean,
  is_active                boolean,
  created_at               timestamptz,
  allowed_tournament_types text[],
  allowed_surfaces         text[],
  season_start_date        date,
  owner_id                 uuid,
  owner_username           text,
  member_count             bigint,
  -- Whether the owner is themselves in league_members. Leaving a league you own
  -- hands ownership on (022), so an owner outside the roster is worth seeing.
  owner_is_member          boolean,
  -- The most recent join. The closest thing the schema has to "is this league
  -- actually alive", without reading the chat or the activity feed.
  last_joined_at           timestamptz,
  total_points             bigint,
  -- Exact size of the filtered set, so the pager can show a real total rather
  -- than probing for one more row. Cheap: the filter is on `leagues`, which is
  -- orders of magnitude smaller than `users`.
  total_rows               bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with counts as (
    select
      lm.league_id,
      count(*)                as member_count,
      max(lm.joined_at)       as last_joined_at,
      sum(lm.total_points)    as total_points
    from public.league_members lm
    group by lm.league_id
  ),
  filtered as (
    select
      l.id, l.name, l.description, l.invite_code, l.is_public, l.is_active,
      l.created_at, l.allowed_tournament_types, l.allowed_surfaces,
      l.season_start_date, l.owner_id,
      u.username                              as owner_username,
      coalesce(c.member_count, 0)             as member_count,
      exists (
        select 1 from public.league_members om
        where om.league_id = l.id and om.user_id = l.owner_id
      )                                       as owner_is_member,
      c.last_joined_at,
      coalesce(c.total_points, 0)             as total_points,
      count(*) over ()                        as total_rows
    from public.leagues l
    left join counts c on c.league_id = l.id
    -- Outer join: the owner row is guaranteed by a foreign key, but an outer
    -- join costs nothing here and an inner one would hide a league entirely if
    -- that ever stopped being true. An admin page must not omit rows silently.
    left join public.users u on u.id = l.owner_id
    where
      (p_visibility = 'all' or l.is_public = (p_visibility = 'public'))
      and (p_status = 'all' or l.is_active = (p_status = 'active'))
      and (
        p_search is null or p_search = ''
        -- Owner name as well as league name: "which leagues does this person
        -- run" is the other half of the question this page answers.
        or l.name ilike '%' || p_search || '%'
        or u.username ilike '%' || p_search || '%'
        -- Exact match only — an invite code is pasted, never typed partially.
        or upper(l.invite_code) = upper(p_search)
      )
  )
  select
    f.id, f.name, f.description, f.invite_code, f.is_public, f.is_active,
    f.created_at, f.allowed_tournament_types, f.allowed_surfaces,
    f.season_start_date, f.owner_id, f.owner_username, f.member_count,
    f.owner_is_member, f.last_joined_at, f.total_points, f.total_rows
  from filtered f
  order by
    case when p_sort = 'members' then f.member_count end desc nulls last,
    case when p_sort = 'name'    then f.name          end asc  nulls last,
    -- Default, and the tiebreak for the other two. Postgres gives no stable
    -- order among equal keys and may pick a different one per call — invisible
    -- under LIMIT, but under OFFSET it shows one league twice and drops another.
    f.created_at desc,
    f.id asc
  limit  greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;

-- ── The roster inside one league, for the drill-down ─────────────────────────
-- Paged for the same reason: nothing stops a public league growing past 1000
-- members, and this is the query that would hit the cap first.
create or replace function public.admin_league_members(
  p_league_id uuid,
  p_limit     int default 100,
  p_offset    int default 0
)
returns table (
  user_id        uuid,
  username       text,
  email          text,
  total_points   bigint,
  ranking_points bigint,
  joined_at      timestamptz,
  is_owner       boolean,
  total_rows     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    lm.user_id,
    u.username,
    u.email,
    lm.total_points::bigint,
    coalesce(u.ranking_points, 0)::bigint,
    lm.joined_at,
    (l.owner_id = lm.user_id) as is_owner,
    count(*) over ()          as total_rows
  from public.league_members lm
  join public.leagues l on l.id = lm.league_id
  left join public.users u on u.id = lm.user_id
  where lm.league_id = p_league_id
  order by lm.total_points desc, lm.joined_at asc, lm.user_id asc
  limit  greatest(1, least(p_limit, 200))
  offset greatest(0, p_offset);
$$;

-- Admin-only surfaces, called with the service-role client. `security definer`
-- means these read past the league RLS policies by design — so they must not be
-- reachable by a logged-in user, who would otherwise see every private league.
revoke all on function public.admin_league_overview(text, text, text, text, int, int)
  from public, anon, authenticated;
revoke all on function public.admin_league_members(uuid, int, int)
  from public, anon, authenticated;
grant execute on function public.admin_league_overview(text, text, text, text, int, int)
  to service_role;
grant execute on function public.admin_league_members(uuid, int, int)
  to service_role;
