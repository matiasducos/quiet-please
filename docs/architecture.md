# Architecture

## Overview

Quiet Please is a Next.js (App Router) web app backed by Supabase. The system has four clear layers:

```
[ Browser ]
     ↓
[ Next.js — Server Components + Client Components ]
     ↓                          ↓
[ Supabase (DB / Auth) ]   [ Tennis data adapter ]
     ↓                          ↓
[ Vercel Cron Jobs ]       [ External tennis API ]
```

## Layers

### Client layer — Next.js App Router
The UI is split between Server Components (fetch data directly, no API hop) and Client Components (interactive UI, prefixed with `'use client'`).

**Server components** handle: page-level data fetching (tournaments, predictions, leaderboard, profile), ISR-cached public pages (tournament detail cached 1 hour), all read-heavy views.

**Client components** handle: bracket picking (`BracketPredictor.tsx`), collapsible month groups (`TournamentMonthGroup.tsx`), location edit form (`LocationEditForm.tsx`), admin panel triggers.

**Server actions** (`actions.ts` files per route) handle all mutations — form submissions call server actions directly without going through an API route.

### Supabase
Handles all backend data:
- **PostgreSQL** — all app data (users, tournaments, predictions, points, leagues, challenges, friendships, notifications)
- **Auth** — email/password + Google OAuth. RLS policies enforce data isolation.
- **No Realtime** — leaderboards and other views are server-rendered; Supabase Realtime is not currently used.
- **No Storage** — avatar upload is not currently implemented.

### Tennis data adapter
Location: `src/lib/tennis/`

A dedicated abstraction layer. **No other part of the app imports from the tennis API directly.** All calls go through `tennisAdapter` exported from `src/lib/tennis/index.ts`, which:
1. Picks the configured provider based on `TENNIS_API_PROVIDER` env var
2. Fetches from that provider
3. Returns normalised TypeScript types

Swapping API providers only requires changes inside `src/lib/tennis/providers/` — zero changes to the rest of the app.

See [api-adapter.md](api-adapter.md) for full details.

### Background jobs — Vercel Cron

All cron jobs are Next.js API routes under `src/app/api/cron/`, triggered by Vercel Cron on the Hobby plan (daily schedules only).

| Job | Route | Purpose |
|---|---|---|
| `sync-tournaments` | `/api/cron/sync-tournaments` | Fetch season calendar from API, insert new tournaments |
| `sync-draws` | `/api/cron/sync-draws` | Fetch bracket data for accepting_predictions tournaments |
| `sync-results` | `/api/cron/sync-results` | Fetch match results for in_progress tournaments |
| `award-points` | `/api/cron/award-points` | Score predictions against results, stamp expires_at, call recalculate_ranking_points(), expire/score challenges |
| `sync-backfill` | `/api/cron/sync-backfill` | One-time / on-demand: catch up past tournaments (draws + results + status = completed) |

All cron jobs require `Authorization: Bearer <CRON_SECRET>` in production. They use `createAdminClient()` (service role) to bypass RLS.

**Vercel Hobby limitation**: cron schedules are daily-only. Upgrading to Vercel Pro enables sub-hourly schedules (e.g. sync-results every 30 min during live tournaments).

### Admin panel
`/admin` (protected by `ADMIN_USER_IDS` env var) allows manually triggering any cron job from the browser without needing to hit API endpoints directly.

---

## Hosting

- **Vercel** — Next.js app, API routes, cron jobs
- **Supabase cloud** — PostgreSQL, Auth (email + Google OAuth)

---

## Key design decisions

### Why Next.js App Router?
Server Components allow direct DB reads without an extra API hop. ISR caching (`unstable_cache` with `revalidate`) keeps public tournament pages fast without needing a CDN layer. Vercel deploys are zero-config.

### Why Supabase over plain PostgreSQL?
Auth out of the box (email + Google OAuth, RLS, JWT). Row Level Security enforces data isolation without application-layer checks. `createAdminClient()` (service role) bypasses RLS for cron jobs and cross-user reads.

### Why an adapter layer for tennis data?
Tennis data APIs vary in quality, cost, and coverage. Starting with a cheaper API and migrating to a premium one (Sportradar) later is realistic. The adapter makes that migration a one-day job.

### Why JSONB for bracket picks?
A full Grand Slam bracket has 127 matches across 7 rounds. JSONB stores the entire bracket as one document — fast to read, easy to evolve the schema, no complex joins per pick.

### Why `ranking_points` instead of `total_points`?
`total_points` is a raw sum with no expiry. `ranking_points` mirrors the ATP rolling 52-week window — points expire 364 days after the tournament, so the leaderboard reflects recent form rather than all-time accumulation. `recalculate_ranking_points()` is a SQL function called by the award-points cron, keeping the logic in one place.

### Why weekly_slots at DB level?
The one-slot-per-week rule could be enforced in application code, but a `UNIQUE(user_id, circuit, iso_year, iso_week)` constraint at the DB level means it's impossible to double-book even if the server action is bypassed or called concurrently.

### Why Server Actions for mutations?
Server Actions (Next.js 14+) let form submissions go directly to server-side code without a separate API route. They integrate cleanly with `revalidatePath` for cache invalidation and make the data flow from UI → mutation → re-render straightforward.
