# Developer Handoff — Quiet Please

## Current status (as of March 15, 2026 — Session 3)

The app is now a working product. Auth, tournaments, bracket predictions, and leaderboard are all functional end-to-end with real data.

### What is working right now
- ✅ Landing page (`/`) with full design system
- ✅ Auth — signup, login, logout, route protection
- ✅ Dashboard (`/dashboard`) — username, points, upcoming tournaments
- ✅ Tournament list (`/tournaments`) — ATP/WTA tabs, real data from API
- ✅ Tournament detail (`/tournaments/[id]`) — surface, dates, points breakdown, draw status
- ✅ Bracket predictor (`/tournaments/[id]/predict`) — pick winners per round, save draft, submit & lock
- ✅ Leaderboard (`/leaderboard`) — global rankings, highlights current user
- ✅ 22 ATP + WTA tournaments in DB (synced from api-tennis.com)
- ✅ Cron: sync-tournaments — fetches full calendar
- ✅ Cron: sync-draws — fetches draws for active tournaments
- ✅ predictions table saving to Supabase with JSONB picks
- ✅ Server Actions for saving/locking predictions

### What is NOT done yet
- Result sync cron (sync match results from API)
- Points engine (award points after results)
- Points actually showing on leaderboard (all 0 until results flow)
- Leagues (create, join, leaderboard)
- Head-to-head challenges
- User profile page
- Logout button in nav
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
│   │   ├── page.tsx             ✅ landing
│   │   ├── globals.css          ✅ design system
│   │   ├── login/page.tsx       ✅
│   │   ├── signup/page.tsx      ✅
│   │   ├── dashboard/page.tsx   ✅ with upcoming tournaments
│   │   ├── tournaments/
│   │   │   ├── page.tsx         ✅ list with ATP/WTA tabs
│   │   │   └── [id]/
│   │   │       ├── page.tsx     ✅ detail page
│   │   │       └── predict/
│   │   │           ├── page.tsx          ✅ server wrapper
│   │   │           ├── BracketPredictor.tsx ✅ client UI
│   │   │           └── actions.ts        ✅ server action
│   │   ├── leaderboard/page.tsx ✅
│   │   ├── auth/callback/route.ts ✅
│   │   └── api/cron/
│   │       ├── sync-tournaments/route.ts ✅ working
│   │       └── sync-draws/route.ts       ✅ working
│   ├── lib/
│   │   ├── supabase/ (client, server, admin, middleware) ✅
│   │   └── tennis/  (adapter, types, points, api-tennis provider) ✅
│   ├── middleware.ts             ✅
│   └── types/database.ts        ✅
├── supabase/migrations/001_initial_schema.sql ✅ run
└── .env.local (not committed)
```

---

## Environment variables (.env.local)

```
NEXT_PUBLIC_SUPABASE_URL=https://nqmjrwqcqnxoocodgedj.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key — Supabase Settings → API Keys>
SUPABASE_SERVICE_ROLE_KEY=<secret key — Supabase Settings → API Keys>
TENNIS_API_KEY=3c017f23c4mshcb90a92890cb23dp103ec3jsn3367cf2e71d1
TENNIS_API_PROVIDER=api-tennis
CRON_SECRET=dev-secret-123
```

---

## Tennis API

Provider: Tennis API - ATP WTA ITF by Matchstat (RapidAPI BASIC free tier)
Host: `tennis-api-atp-wta-itf.p.rapidapi.com`

Key endpoints:
- `tennis/v2/{type}/tournament/calendar/{year}` → full season calendar
- `tennis/v2/{type}/fixtures/tournament/{id}` → match fixtures (draw + results)
- `tennis/v2/{type}/fixtures/{from}/{to}` → fixtures by date range

roundId mapping: 1=F, 2=SF, 3=QF, 4=R16, 5=R32, 6=R64, 7=R128

Rate limit: free tier is strict — use sequential requests with 500ms delay between ATP/WTA calls.

---

## Test data in DB

Japan Open Tennis Championships - Tokyo (`id: 5f21f18e-5e6b-4b72-804a-3c114a5f8022`):
- Status: `accepting_predictions`
- Has a mock draw seeded with 4 QF matches (Alcaraz, Sinner, Zverev, Medvedev)
- Used for testing the bracket predictor

---

## Immediate next steps (in order)

### Step 1 — Add logout button to nav
All pages share the same nav pattern. Add a logout form action to the nav.
In each page's nav, add:
```tsx
<form action="/auth/logout" method="post">
  <button type="submit" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
    Sign out
  </button>
</form>
```
And create `src/app/auth/logout/route.ts`:
```ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'))
}
```

### Step 2 — Build result sync cron
File: `src/app/api/cron/sync-results/route.ts`
- Query tournaments with `status = 'in_progress'`
- Call `tennisAdapter.getResults(externalId)` for each
- Upsert into `match_results` table
- After each upsert, trigger points engine

### Step 3 — Build points engine
File: `src/app/api/cron/award-points/route.ts`
- For each new match result, find all predictions for that tournament
- Parse `predictions.picks` JSONB
- If `picks[matchId] === result.winnerExternalId` → correct pick
- Insert into `point_ledger`, update `predictions.points_earned`, update `users.total_points`
- Points values from `src/lib/tennis/points.ts`

### Step 4 — Build leagues
Files:
- `src/app/leagues/page.tsx` — list user's leagues
- `src/app/leagues/new/page.tsx` — create form
- `src/app/leagues/[id]/page.tsx` — league detail + leaderboard
- `src/app/leagues/join/[code]/page.tsx` — join via invite code

### Step 5 — Deploy to Vercel
- Connect GitHub repo to Vercel
- Add all env vars in Vercel dashboard
- Set up Vercel cron jobs for sync-tournaments (daily) and sync-draws (every 3 hours)
- Add `NEXT_PUBLIC_SITE_URL` env var pointing to production URL

### Step 6 — User profile page
File: `src/app/profile/[username]/page.tsx`
- Show total points, global rank, prediction history, accuracy stats

---

## Open product decisions

1. Should ATP Challenger events be included or only main tour + WTA?
2. When no draw exists, show tournament in "upcoming" state — done. OK?
3. If a player retires mid-tournament, void that pick or mark as loss?
4. Can users see each other's predictions before draw closes?
5. Max league size?
6. Does season-long challenge auto-include all tournaments or admin-selectable?
7. Global leaderboard: all-time or reset per calendar year?
8. Separate ATP/WTA leaderboards or combined?
9. Monetisation model?
10. Re-enable email confirmation before production?

---

## Design system

CSS variables in `src/app/globals.css`:
- `--court` (#1a6b3c) — primary green
- `--court-dark` (#0f4a29) — dark green
- `--clay` (#c8530a) — clay orange
- `--chalk` (#f5f2eb) — page background
- `--ink` (#0d0d0d) — primary text
- `--muted` (#6b6b6b) — secondary text
- Fonts: DM Serif Display (headings), DM Sans (body), DM Mono (labels)

## Repository
https://github.com/matiasducos/quiet-please