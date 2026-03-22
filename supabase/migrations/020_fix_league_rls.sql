-- Migration: 020_fix_league_rls
-- Fixes league member visibility by replacing self-referencing RLS policies
-- with a SECURITY DEFINER function that cleanly bypasses RLS.
--
-- The old league_members SELECT policy used a correlated self-referencing
-- subquery which can behave unreliably through PostgREST's connection pooling,
-- causing members to only see their own row instead of all league members.

-- Helper: returns the league IDs the calling user belongs to.
-- SECURITY DEFINER so it bypasses RLS on league_members (avoids recursion).
create or replace function public.my_league_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select league_id from public.league_members where user_id = auth.uid();
$$;

-- Drop old policies
drop policy if exists "League members can read their leagues" on public.leagues;
drop policy if exists "Members can read their league memberships" on public.league_members;

-- Recreate with the helper function (no self-referencing subquery)
create policy "League members can read their leagues"
  on public.leagues for select
  using (id in (select my_league_ids()));

create policy "Members can read league members"
  on public.league_members for select
  using (league_id in (select my_league_ids()));
