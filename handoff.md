# Developer Handoff — Quiet Please

## Current status (as of March 15, 2026)

The project has a working foundation with auth, database, and live tennis API data flowing into the database. 22 tournaments were successfully synced in the last session.

### What is working right now
- ✅ Next.js 16 app running at localhost:3000
- ✅ Landing page (`/`) with full design system
- ✅ `/login` and `/signup` pages — fully working end-to-end with Supabase
- ✅ `/auth/callback` route for OAuth
- ✅ `/dashboard` — authenticated, shows username and points
- ✅ Route protection via middleware (unauthenticated users redirected to /login)
- ✅ Supabase browser/server/admin clients configured and working
- ✅ All 9 DB tables created with RLS policies and indexes
- ✅ Auto-user-creation trigger (new auth user → public.users row)
- ✅ Tennis data adapter — api-tennis.com provider fully implemented
- ✅ `/api/cron/sync-tournaments` — syncs ATP & WTA calendar, 22 tournaments in DB
- ✅ `/api/cron/sync-draws` — written, not yet tested
- ✅ Email/password auth working (email confirmation disabled for dev)
- ✅ Google OAuth UI present but not configured (needs Google Cloud credentials)

### What is NOT done yet
- Tournament list page (shows tournaments to users)
- Bracket/draw viewer
- Bracket prediction UI
- Points engine (awards points after match results)
- Result sync cron job
- Global leaderboard
- Leagues and challenges
- User profile page
- Vercel deployment

---

## Project structure

```
quiet-please/
├── docs/
│   ├── architecture.md
│   ├── database.md
│   ├── api-adapter.md
│   ├── roadmap.md
│   └── handoff.md              ← this file
├── src/
│   ├── app/
│   │   ├── layout.tsx           ✅
│   │   ├── page.tsx             ✅ landing page
│   │   ├── globals.css          ✅ design system
│   │   ├── login/page.tsx       ✅ working
│   │   ├── signup/page.tsx      ✅ working
│   │   ├── dashboard/page.tsx   ✅ placeholder
│   │   ├── auth/callback/route.ts ✅
│   │   └── api/cron/
│   │       ├── sync-tournaments/route.ts ✅ tested, working
│   │       └── sync-draws/route.ts       ✅ written, not tested
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts        ✅
│   │   │   ├── server.ts        ✅
│   │   │   ├── admin.ts         ✅
│   │   │   └── middleware.ts    ✅
│   │   └── tennis/
│   │       ├── index.ts         ✅
│   │       ├── types.ts         ✅
│   │       ├── points.ts        ✅
│   │       └── providers/
│   │           ├── base.ts          ✅
│   │           ├── api-tennis.ts    ✅ working
│   │           └── sportradar.ts    stub only
│   ├── middleware.ts             ✅
│   └── types/
│       └── database.ts           ✅
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql ✅ RUN — all tables exist
├── setup-pages.sh               (can be deleted)
├── fix-provider.sh              (can be deleted)
├── .env.local                   (local only, not committed)
└── .env.example
```

---

## Environment variables (.env.local)

```
NEXT_PUBLIC_SUPABASE_URL=https://nqmjrwqcqnxoocodgedj.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key — new format, get from Supabase Settings → API Keys>
SUPABASE_SERVICE_ROLE_KEY=<secret key — get from Supabase Settings → API Keys>
TENNIS_API_KEY=3c017f23c4mshcb90a92890cb23dp103ec3jsn3367cf2e71d1
TENNIS_API_PROVIDER=api-tennis
CRON_SECRET=dev-secret-123
```

**Key notes:**
- Supabase rotated JWT secret during setup — use NEW publishable/secret keys (not legacy anon/service_role)
- Tennis API is via RapidAPI (BASIC free tier, 500 req/month) — subscribed to "Tennis API - ATP WTA ITF" by Matchstat
- `CRON_SECRET` not enforced in development (NODE_ENV=development bypasses auth check)

---

## Tennis API details

Provider: **Tennis API - ATP WTA ITF** by Matchstat on RapidAPI
RapidAPI host: `tennis-api-atp-wta-itf.p.rapidapi.com`
Plan: BASIC (free, limited requests)

Key endpoints used:
- `GET tennis/v2/{type}/tournament/calendar/{year}` — full season calendar (ATP/WTA)
- `GET tennis/v2/{type}/fixtures/tournament/{tournamentId}` — all matches for a tournament
- `GET tennis/v2/{type}/fixtures/{startdate}/{enddate}` — fixtures by date range

Response structure:
```json
{
  "data": [
    {
      "id": 21364,
      "name": "Nitto ATP Finals - Turin",
      "courtId": 3,
      "date": "2026-11-16T00:00:00.000Z",
      "rankId": 7,
      "court": { "id": 3, "name": "I.hard" },
      "round": { "id": 7, "name": "Tour finals" },
      "coutry": { "acronym": "ITA", "name": "Italy" }
    }
  ]
}
```

Fixture response structure:
```json
{
  "data": [
    {
      "id": 1722,
      "date": "2026-03-17T12:00:00.000Z",
      "roundId": 4,
      "player1Id": 29457,
      "player2Id": 51853,
      "tournamentId": 21512,
      "player1": { "id": 29457, "name": "Andrea Pellegrino", "countryAcr": "ITA" },
      "player2": { "id": 51853, "name": "Pol Martin Tiffon", "countryAcr": "ESP" }
    }
  ],
  "hasNextPage": true
}
```

roundId mapping (confirmed from API):
- 1 = Final
- 2 = Semifinal
- 3 = Quarterfinal
- 4 = Round of 16
- 5 = Round of 32
- 6 = Round of 64
- 7 = Round of 128

---

## Supabase project

Project ID: `nqmjrwqcqnxoocodgedj`
URL: `https://nqmjrwqcqnxoocodgedj.supabase.co`
Dashboard: https://supabase.com/dashboard/project/nqmjrwqcqnxoocodgedj

Auth settings:
- Email provider: enabled
- Confirm email: DISABLED (for development — re-enable before production)
- Google OAuth: not configured

---

## Immediate next steps (in order)

### Step 1 — Test sync-draws endpoint
Hit: `http://localhost:3000/api/cron/sync-draws`
This will try to fetch draws for all 22 tournaments in the DB.
Note: many may return empty (draw not published yet) — that's expected.

### Step 2 — Build tournament list page
File: `src/app/tournaments/page.tsx`

Server component. Query:
```ts
const { data } = await supabase
  .from('tournaments')
  .select('*')
  .order('starts_at', { ascending: true })
```

Display as cards showing: name, tour badge (ATP/WTA), surface, category, start date, status badge.
Add ATP/WTA filter tabs.
Link each card to `/tournaments/[id]`.

### Step 3 — Build tournament detail + prediction page
File: `src/app/tournaments/[id]/page.tsx`
File: `src/app/tournaments/[id]/predict/page.tsx`

Tournament detail shows: name, surface, draw, prediction CTA.
Prediction page renders the bracket from `draws.bracket_data` JSONB.
User clicks player names to pick winners round by round.
Picks cascade (picking winner in R16 auto-advances them to QF slot).
Saves to `predictions` table as JSONB.
Lock button / auto-lock at `draw_close_at`.

### Step 4 — Build result sync cron
File: `src/app/api/cron/sync-results/route.ts`

For each `in_progress` tournament, call `tennisAdapter.getResults(externalId)`.
Upsert into `match_results` table.
Trigger points engine after each batch.

### Step 5 — Build points engine
File: `src/app/api/cron/award-points/route.ts`

For each new match result:
1. Find all predictions for that tournament
2. Compare each prediction's picks JSON against the result
3. If correct: insert into `point_ledger`, update `predictions.points_earned`, update `users.total_points`

Points values are in `src/lib/tennis/points.ts`.

### Step 6 — Global leaderboard
File: `src/app/leaderboard/page.tsx`

Query `users` ordered by `total_points` DESC with pagination.

### Step 7 — Leagues
Files:
- `src/app/leagues/page.tsx`
- `src/app/leagues/new/page.tsx`
- `src/app/leagues/[id]/page.tsx`
- `src/app/leagues/join/[code]/page.tsx`

---

## Open product decisions

1. Should ATP Challenger events be included or only main tour + WTA?
2. Should qualifying rounds be in the prediction bracket?
3. When no draw exists yet, show tournament in "upcoming" state or hide it?
4. If a player retires mid-tournament, void that pick or mark as loss?
5. Can users see each other's predictions before tournament starts?
6. Max league size?
7. Does season-long challenge auto-include all tournaments or admin-selectable?
8. Global leaderboard: all-time or reset per calendar year?
9. Separate ATP/WTA leaderboards or combined?
10. Monetisation model (paid leagues, subscriptions, ads)?
11. Re-enable email confirmation before production?

---

## Design system

CSS variables in `src/app/globals.css`:
- `--court` (#1a6b3c) — primary green
- `--court-dark` (#0f4a29) — dark green
- `--clay` (#c8530a) — clay orange accent
- `--chalk` (#f5f2eb) — page background
- `--ink` (#0d0d0d) — primary text
- `--muted` (#6b6b6b) — secondary text
- Fonts: DM Serif Display (headings), DM Sans (body), DM Mono (labels)

## Repository
https://github.com/matiasducos/quiet-please