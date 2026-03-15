-- Migration: 001_initial_schema
-- Description: Core tables for Quiet Please tennis prediction app

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- USERS
-- Extended profile linked to Supabase auth.users
-- ============================================================
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null,
  email         text not null,
  avatar_url    text,
  total_points  int not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "Users can read all profiles"
  on public.users for select using (true);

create policy "Users can update their own profile"
  on public.users for update using (auth.uid() = id);

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, username)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- TOURNAMENTS
-- ============================================================
create table public.tournaments (
  id              uuid primary key default gen_random_uuid(),
  external_id     text unique not null,
  name            text not null,
  tour            text not null check (tour in ('ATP', 'WTA')),
  category        text not null check (category in ('grand_slam', 'masters_1000', '500', '250')),
  surface         text check (surface in ('hard', 'clay', 'grass')),
  draw_close_at   timestamptz,
  starts_at       timestamptz,
  ends_at         timestamptz,
  status          text not null default 'upcoming'
                  check (status in ('upcoming', 'accepting_predictions', 'in_progress', 'completed'))
);

alter table public.tournaments enable row level security;

create policy "Tournaments are publicly readable"
  on public.tournaments for select using (true);

-- ============================================================
-- DRAWS
-- ============================================================
create table public.draws (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references public.tournaments(id) on delete cascade,
  bracket_data    jsonb not null default '{}',
  synced_at       timestamptz not null default now(),
  unique (tournament_id)
);

alter table public.draws enable row level security;

create policy "Draws are publicly readable"
  on public.draws for select using (true);

-- ============================================================
-- PREDICTIONS
-- ============================================================
create table public.predictions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  tournament_id   uuid not null references public.tournaments(id) on delete cascade,
  picks           jsonb not null default '{}',
  is_locked       bool not null default false,
  points_earned   int not null default 0,
  submitted_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, tournament_id)
);

alter table public.predictions enable row level security;

create policy "Users can read their own predictions"
  on public.predictions for select using (auth.uid() = user_id);

create policy "Users can insert their own predictions"
  on public.predictions for insert with check (auth.uid() = user_id);

create policy "Users can update unlocked predictions"
  on public.predictions for update
  using (auth.uid() = user_id and is_locked = false);

-- ============================================================
-- MATCH RESULTS
-- ============================================================
create table public.match_results (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid not null references public.tournaments(id) on delete cascade,
  external_match_id   text not null,
  round               text not null check (round in ('R128','R64','R32','R16','QF','SF','F')),
  winner_external_id  text not null,
  loser_external_id   text not null,
  score               text,
  played_at           timestamptz,
  unique (tournament_id, external_match_id)
);

alter table public.match_results enable row level security;

create policy "Match results are publicly readable"
  on public.match_results for select using (true);

-- ============================================================
-- POINT LEDGER
-- Append-only. Never updated, only inserted (via service role).
-- ============================================================
create table public.point_ledger (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  tournament_id     uuid not null references public.tournaments(id) on delete cascade,
  match_result_id   uuid not null references public.match_results(id) on delete cascade,
  round             text not null,
  points            int not null,
  awarded_at        timestamptz not null default now()
);

alter table public.point_ledger enable row level security;

create policy "Users can read their own point ledger"
  on public.point_ledger for select using (auth.uid() = user_id);

-- ============================================================
-- LEAGUES
-- ============================================================
create table public.leagues (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.users(id) on delete cascade,
  name          text not null,
  description   text,
  invite_code   text unique not null default upper(substring(gen_random_uuid()::text from 1 for 8)),
  is_active     bool not null default true,
  created_at    timestamptz not null default now()
);

alter table public.leagues enable row level security;

create policy "League members can read their leagues"
  on public.leagues for select
  using (
    exists (
      select 1 from public.league_members
      where league_id = leagues.id and user_id = auth.uid()
    )
  );

create policy "Users can create leagues"
  on public.leagues for insert with check (auth.uid() = owner_id);

create policy "Owners can update their leagues"
  on public.leagues for update using (auth.uid() = owner_id);

-- ============================================================
-- LEAGUE MEMBERS
-- ============================================================
create table public.league_members (
  league_id     uuid not null references public.leagues(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  total_points  int not null default 0,
  joined_at     timestamptz not null default now(),
  primary key (league_id, user_id)
);

alter table public.league_members enable row level security;

create policy "Members can read their league memberships"
  on public.league_members for select
  using (
    user_id = auth.uid() or
    exists (
      select 1 from public.league_members lm2
      where lm2.league_id = league_members.league_id and lm2.user_id = auth.uid()
    )
  );

create policy "Users can join leagues"
  on public.league_members for insert with check (auth.uid() = user_id);

-- ============================================================
-- CHALLENGES
-- ============================================================
create table public.challenges (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid references public.leagues(id) on delete cascade,
  challenger_id   uuid not null references public.users(id) on delete cascade,
  opponent_id     uuid not null references public.users(id) on delete cascade,
  tournament_id   uuid references public.tournaments(id) on delete cascade,
  status          text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'completed')),
  created_at      timestamptz not null default now()
);

alter table public.challenges enable row level security;

create policy "Users can read challenges they are part of"
  on public.challenges for select
  using (auth.uid() = challenger_id or auth.uid() = opponent_id);

create policy "Users can create challenges"
  on public.challenges for insert with check (auth.uid() = challenger_id);

create policy "Opponents can respond to challenges"
  on public.challenges for update
  using (auth.uid() = opponent_id and status = 'pending');

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_predictions_user_id on public.predictions(user_id);
create index idx_predictions_tournament_id on public.predictions(tournament_id);
create index idx_point_ledger_user_id on public.point_ledger(user_id);
create index idx_point_ledger_tournament_id on public.point_ledger(tournament_id);
create index idx_match_results_tournament_id on public.match_results(tournament_id);
create index idx_league_members_user_id on public.league_members(user_id);
create index idx_challenges_challenger on public.challenges(challenger_id);
create index idx_challenges_opponent on public.challenges(opponent_id);
