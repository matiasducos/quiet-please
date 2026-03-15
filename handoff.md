# Developer Handoff — Quiet Please

## Current status (as of March 15, 2026 — Session 4)

The app is a working product with auth, tournaments, bracket predictions, leaderboard, result sync, and points engine all built. The main missing pieces are: sign out button wired to UI, points actually flowing (needs match results), and leagues.

### What is working right now
- ✅ Landing page with full design system
- ✅ Auth — signup, login, route protection
- ✅ Dashboard — username, points, upcoming tournaments
- ✅ Tournament list (`/tournaments`) — ATP/WTA tabs, real data
- ✅ Tournament detail (`/tournaments/[id]`) — draw status, points breakdown
- ✅ Bracket predictor (`/tournaments/[id]/predict`) — pick, save draft, submit & lock
- ✅ Leaderboard (`/leaderboard`) — global rankings, current user highlight
- ✅ 22 ATP + WTA tournaments in DB
- ✅ Cron: sync-tournaments, sync-draws, sync-results, award-points — all written
- ✅ `/auth/logout` route written
- ✅ `src/components/Nav.tsx` shared nav component written
- ✅ `increment_user_points` Supabase function — **needs to be confirmed created**

### What is NOT done yet
- Sign out button not yet visible in nav (logout route exists, not wired to UI pages)
- Points engine not yet tested (needs real match results)
- Duplicate "China Open - Beijing" in WTA — needs cleanup SQL
- Leagues (create, join, leaderboard per group)
- Head-to-head challenges
- User profile page
- Vercel deployment

---

## Pending SQL to run in Supabase

**1. increment_user_points function** (required for points engine):
```sql
CREATE OR REPLACE FUNCTION public.increment_user_points(user_id uuid, points int)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.users
  SET total_points = total_points + points
  WHERE id = user_id;
$$;
```

**2. Fix duplicate China Open:**
```sql
DELETE FROM tournaments
WHERE name = 'China Open - Beijing'
AND tour = 'WTA'
AND id = (
  SELECT id FROM tournaments
  WHERE name = 'China Open - Beijing' AND tour = 'WTA'
  LIMIT 1
);
```

---

## Project structure

```
quiet-please/
├── docs/
│   ├── architecture.md
│   ├── database.md
│   ├── api-adapter.md
│   ├── roadmap.md
│   └── handoff.md
├── src/
│   ├── app/
│   │   ├── layout.tsx                    ✅
│   │   ├── page.tsx                      ✅ landing
│   │   ├── globals.css                   ✅ design system
│   │   ├── login/page.tsx                ✅
│   │   ├── signup/page.tsx               ✅
│   │   ├── dashboard/page.tsx            ✅
│   │   ├── tournaments/
│   │   │   ├── page.tsx                  ✅
│   │   │   └── [id]/
│   │   │       ├── page.tsx              ✅
│   │   │       └── predict/
│   │   │           ├── page.tsx          ✅
│   │   │           ├── BracketPredictor.tsx ✅
│   │   │           └── actions.ts        ✅
│   │   ├── leaderboard/page.tsx          ✅
│   │   ├── auth/
│   │   │   ├── callback/route.ts         ✅
│   │   │   └── logout/route.ts           ✅ (not yet wired to nav)
│   │   └── api/cron/
│   │       ├── sync-tournaments/route.ts ✅ tested
│   │       ├── sync-draws/route.ts       ✅ tested
│   │       ├── sync-results/route.ts     ✅ written, not tested
│   │       └── award-points/route.ts     ✅ written, not tested
│   ├── components/
│   │   └── Nav.tsx                       ✅ written, not yet used by pages
│   ├── lib/
│   │   ├── supabase/ (client, server, admin, middleware) ✅
│   │   └── tennis/ (adapter, types, points, provider)   ✅
│   ├── middleware.ts                      ✅
│   └── types/database.ts                 ✅
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
Endpoints:
- `tennis/v2/{type}/tournament/calendar/{year}` → season calendar
- `tennis/v2/{type}/fixtures/tournament/{id}` → draw + results
- `tennis/v2/{type}/fixtures/{from}/{to}` → fixtures by date range

roundId: 1=F, 2=SF, 3=QF, 4=R16, 5=R32, 6=R64, 7=R128
Rate limit: free tier — use sequential requests with 500ms delay.

---

## Test data in DB

Japan Open Tennis Championships - Tokyo (`id: 5f21f18e-5e6b-4b72-804a-3c114a5f8022`):
- Status: `accepting_predictions`
- Mock draw: 4 QF matches (Alcaraz vs Rune, Zverev vs Rublev, Medvedev vs Ruud, Sinner vs Paul)
- SF and F matches with null players (TBD)

---

## Immediate next steps (in order)

### Step 1 — Run pending SQL (see above)
Run both SQL statements in Supabase SQL Editor.

### Step 2 — Wire sign out to all nav bars
Each page has an inline nav. Find the `score-pill` span and add right after it:
```tsx
<form action="/auth/logout" method="post">
  <button type="submit" style={{ fontSize: '0.8rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
    Sign out
  </button>
</form>
```
Pages to update: dashboard, tournaments, tournaments/[id], leaderboard, tournaments/[id]/predict (BracketPredictor.tsx nav)

Alternatively — refactor all pages to use `src/components/Nav.tsx` which already has the sign out button built in.

### Step 3 — Test the result sync and points engine
Seed a match result manually for Japan Open in Supabase SQL Editor, then lock the test prediction, then hit `/api/cron/award-points` and verify points appear on leaderboard.

Seed SQL:
```sql
INSERT INTO public.match_results (tournament_id, external_match_id, round, winner_external_id, loser_external_id, score, played_at)
VALUES (
  '5f21f18e-5e6b-4b72-804a-3c114a5f8022',
  'test_qf_1',
  'QF',
  'p1',
  'p2',
  '6-3 6-4',
  NOW()
);
```
(p1 = Alcaraz's externalId in our mock draw)

Then hit: `http://localhost:3000/api/cron/award-points`

### Step 4 — Build leagues
Files to create:
- `src/app/leagues/page.tsx` — list user's leagues + create button
- `src/app/leagues/new/page.tsx` — create league form
- `src/app/leagues/[id]/page.tsx` — league leaderboard + members
- `src/app/leagues/join/[code]/page.tsx` — join via invite code

### Step 5 — Deploy to Vercel
- Connect GitHub repo to Vercel
- Add all env vars in Vercel dashboard
- Set up cron jobs (sync-tournaments daily, sync-draws every 3h)
- Add `NEXT_PUBLIC_SITE_URL` env var

---

## Open product decisions

1. ATP Challengers included or main tour only?
2. Player retires mid-tournament — void pick or loss?
3. Can users see others' picks before draw closes?
4. Max league size?
5. Season-long challenge: all tournaments or admin-selectable?
6. Global leaderboard: all-time or reset per year?
7. Separate ATP/WTA leaderboards or combined?
8. Monetisation model?
9. Re-enable email confirmation before production?

---

## Design system

CSS variables (`src/app/globals.css`):
- `--court` #1a6b3c — primary green
- `--court-dark` #0f4a29 — dark green
- `--clay` #c8530a — clay orange
- `--chalk` #f5f2eb — page background
- `--ink` #0d0d0d — primary text
- `--muted` #6b6b6b — secondary text
- Fonts: DM Serif Display (headings), DM Sans (body), DM Mono (labels/mono)

## Repository
https://github.com/matiasducos/quiet-please