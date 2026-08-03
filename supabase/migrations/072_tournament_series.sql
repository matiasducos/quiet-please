-- 072_tournament_series
--
-- Models the recurring-tournament relationship explicitly: one SERIES (Wimbledon)
-- has many EDITIONS (Wimbledon 2026, Wimbledon 2027), each of which is a row in
-- public.tournaments.
--
-- Why a real table rather than inferring the relationship from name matching:
-- 22 of the 34 rows currently in the table are sponsor names ("Terra Wortmann
-- Open", "Generali Open", "HSBC Championships"), and sponsors change. Name
-- matching would split one series into several the first time a title deal
-- lapses, and would merge genuinely different events that share a city — ATP
-- Stuttgart (BOSS Open, grass, June) and WTA Stuttgart (Porsche Tennis Grand
-- Prix, indoor clay, April) are unrelated tournaments.
--
-- A series is deliberately TOUR-AGNOSTIC: Wimbledon is one series whose 2026
-- edition has an ATP row and a WTA row. Nobody searches "wimbledon ATP bracket",
-- so splitting by tour would halve the content on each page and split the
-- inbound links across two URLs.

-- ============================================================
-- TOURNAMENT SERIES
-- ============================================================
create table if not exists public.tournament_series (
  id            uuid primary key default gen_random_uuid(),

  -- The public URL segment: /tournaments/<slug> and /tournaments/<slug>/<year>.
  --
  -- Generated ONCE at creation and never recomputed from `name`. This is the
  -- whole point of the column: `tournaments.name` carries the current title
  -- sponsor and changes most seasons, and a URL that moves when a sponsor
  -- changes throws away every backlink pointing at it.
  slug          text not null unique,

  -- Canonical display name, tour-agnostic and sponsor-free ("Italian Open",
  -- not "Internazionali BNL d'Italia"). Editions keep their own branded
  -- `tournaments.name` for in-page display.
  name          text not null,
  -- Compact form for <title> tags, where the full name would blow the ~60
  -- character budget ("Queen's Club" for "Queen's Club Championships").
  short_name    text,

  -- Venue hints only. `tournaments.location` on each edition is authoritative:
  -- the Canadian Open alternates Montreal and Toronto by year, and the ATP and
  -- WTA legs swap cities within the same season, so a series-level city is
  -- wrong for at least one edition by construction.
  city          text,
  country       text,
  flag_emoji    text,

  surface       text check (surface in ('hard', 'clay', 'grass')),
  category      text check (category in ('grand_slam', 'masters_1000', '500', '250')),

  -- False for series auto-created by the sync cron, which cannot pick a good
  -- slug. Unreviewed series are noindex'd and kept out of the sitemap, so a
  -- machine-guessed slug never becomes a permanent indexed URL without a human
  -- confirming it. Admin-created series are born true.
  slug_reviewed boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The URL contract, enforced where no code path can route around it:
  -- lowercase kebab-case, no leading/trailing/doubled hyphens.
  constraint tournament_series_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  constraint tournament_series_slug_length
    check (char_length(slug) between 2 and 60),

  -- /tournaments/[slug] resolves a UUID-shaped param as a legacy tournament id
  -- and redirects it. A slug that is itself UUID-shaped would be unreachable —
  -- and it passes the kebab-case check above, so it needs its own guard.
  constraint tournament_series_slug_not_uuid
    check (slug !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

alter table public.tournament_series enable row level security;

-- Same posture as public.tournaments: these back public, indexable pages.
drop policy if exists "Tournament series are publicly readable" on public.tournament_series;
create policy "Tournament series are publicly readable"
  on public.tournament_series for select using (true);

-- ============================================================
-- EDITIONS
--
-- Note there is no `edition_year` column. `starts_year` (added in 008) already
-- is the edition year, and the existing (external_id, starts_year) unique index
-- depends on it. A second year column would be a guaranteed drift bug.
--
-- There is likewise no new status column. The existing 5-state `status`
-- (upcoming → draw_published → accepting_predictions → in_progress → completed)
-- is strictly richer than upcoming/live/completed and drives the prediction
-- lifecycle; the SEO layer maps it down at render time.
-- ============================================================
alter table public.tournaments
  add column if not exists series_id  uuid references public.tournament_series(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

-- One edition per series per year per tour. This is what makes
-- /tournaments/<slug>/<year> resolve to at most one ATP row and one WTA row.
-- Partial so rows can sit un-migrated (NULL series_id) without colliding —
-- the backfill in 067 can run incrementally, and a newly synced tournament is
-- never blocked from inserting before someone assigns its series.
create unique index if not exists tournaments_series_year_tour_key
  on public.tournaments (series_id, starts_year, tour)
  where series_id is not null;

create index if not exists idx_tournaments_series_id
  on public.tournaments (series_id);

-- ============================================================
-- updated_at
--
-- The sitemap's <lastmod> must come from real mutations. Without this the only
-- honest signal available is draws.synced_at, which misses status changes and
-- date corrections entirely, and the alternative — build time — tells crawlers
-- every page changed on every deploy, which teaches them to ignore the field.
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tournaments_touch_updated_at on public.tournaments;
create trigger tournaments_touch_updated_at
  before update on public.tournaments
  for each row execute function public.touch_updated_at();

drop trigger if exists tournament_series_touch_updated_at on public.tournament_series;
create trigger tournament_series_touch_updated_at
  before update on public.tournament_series
  for each row execute function public.touch_updated_at();
