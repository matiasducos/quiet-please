-- Migration: 088_tournament_seasons
-- The seasons that actually have tournaments, per tour.
--
-- /tournaments now defaults to the current season and offers a year picker, so
-- it needs the set of years with at least one event. PostgREST cannot express
-- `select distinct`: the client-side equivalent is selecting starts_year for
-- every tournament row and de-duplicating in Node, which is O(tournaments) over
-- the wire to produce a handful of integers and — worse — silently truncates at
-- PostgREST's 1000-row ceiling. At roughly 120 events a season that is about
-- eight seasons before the *oldest* years quietly stop appearing in the
-- dropdown, with no error raised anywhere. See the same failure mode in
-- 076/084: a capped list reads as a complete one.
--
-- Grouping in Postgres keeps the transfer O(distinct years) and has no ceiling.

-- The output columns are deliberately NOT named starts_year: a RETURNS TABLE
-- column name is an output parameter, and one that collides with a column of
-- the table being read is the classic "column reference is ambiguous" trap.
-- Every reference below is qualified, so it would most likely resolve — but
-- "most likely" is not a thing to ship in a function that cannot be tested
-- without a database, and `season` is the better name anyway.
create or replace function public.tournament_seasons(p_tour text)
returns table (
  season           int,
  tournament_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  -- starts_year is smallint (008); cast so the JSON side gets a plain number
  -- rather than depending on how the driver widens it.
  select t.starts_year::int as season,
         count(*)           as tournament_count
  from public.tournaments t
  where t.tour = p_tour
    and t.starts_year is not null
  group by t.starts_year
  order by t.starts_year desc;
$$;

comment on function public.tournament_seasons(text) is
  'Seasons with at least one tournament on the given tour, newest first. Feeds the year picker on /tournaments.';

grant execute on function public.tournament_seasons(text) to service_role;

-- Serves both the function above and the list query, which is now
-- `tour = ? and starts_year = ?`. 072 indexed (series_id, starts_year, tour),
-- which cannot answer either — series_id leads.
create index if not exists idx_tournaments_tour_starts_year
  on public.tournaments (tour, starts_year);
