-- Migration: 021_league_features
-- Adds: public/private leagues, kick members, tournament type filtering.

-- ── 1. New columns ──────────────────────────────────────────────────────────
alter table public.leagues
  add column if not exists is_public boolean not null default false;

-- NULL = all tournament types count; otherwise only listed categories contribute points
alter table public.leagues
  add column if not exists allowed_tournament_types text[] default null;

-- ── 2. Update leagues SELECT policy to include public leagues ───────────────
drop policy if exists "League members can read their leagues" on public.leagues;

create policy "League members and public leagues are readable"
  on public.leagues for select
  using (
    is_public = true
    or id in (select my_league_ids())
  );

-- ── 3. Owners can kick members (DELETE policy on league_members) ────────────
create policy "Owners can remove league members"
  on public.league_members for delete
  using (
    exists (
      select 1 from public.leagues
      where id = league_members.league_id and owner_id = auth.uid()
    )
  );
