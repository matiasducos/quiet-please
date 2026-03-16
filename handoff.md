# Developer Handoff — Quiet Please

## Current status (as of March 16, 2026 — Session 7)

The app is a fully working product, live in production. All core features are built, tested, and deployed. The only remaining item is Google OAuth.

### What is working right now
- ✅ Landing page with full design system (chalk bg, court green, DM Serif Display)
- ✅ Auth — signup, login, logout, route protection
- ✅ Dashboard — username, points, upcoming tournaments
- ✅ Tournament list (`/tournaments`) — ATP/WTA tabs, real data from API
- ✅ Tournament detail (`/tournaments/[id]`) — draw status, points breakdown, Make predictions button
- ✅ Bracket predictor (`/tournaments/[id]/predict`) — pick winners per round, save draft, submit & lock
- ✅ Leaderboard (`/leaderboard`) — global rankings, current user highlight, medal emojis
- ✅ Leagues (`/leagues`) — create, join with invite code, per-league leaderboard
- ✅ 22 ATP + WTA tournaments in DB (synced from api-tennis.com)
- ✅ Cron: sync-tournaments, sync-draws, sync-results, award-points — all working
- ✅ Points engine tested — 29 pts awarded for correct QF pick, showing in nav and leaderboard
- ✅ CSS variables fixed — all buttons, colors, fonts working across entire app
- ✅ League points synced — award-points cron now propagates to league_members.total_points
- ✅ User profile page (`/profile/[username]`) — points, rank, hit rate, predictions history
- ✅ Leaderboard usernames link to profile pages
- ✅ Deployed to production at https://quiet-please.vercel.app
- ✅ Vercel cron jobs configured (daily schedules — Hobby plan limit)
- ✅ Supabase Auth redirect URLs updated for production

### Known bugs
- None outstanding.

### What is NOT done yet
- Email confirmation disabled (re-enable before production)
- TypeScript build errors suppressed via `ignoreBuildErrors: true` — fix properly by running `supabase gen types typescript` to generate DB types
- Google OAuth users get auto-generated username (e.g. `matiasducos9`) — consider adding a username-pick step on first Google login
- Cron schedules are daily-only (Vercel Hobby plan limit) — upgrade to Vercel Pro ($20/mo) to restore sub-hourly syncs (sync-results every 30 min, award-points every 35 min). **Only matters when going fully public with live tournament data.**

---

## Project structure

```
quiet-please/
├── docs/
│   ├── architecture.md, database.md, api-adapter.md, roadmap.md, handoff.md
├── src/
│   ├── app/
│   │   ├── layout.tsx, page.tsx, globals.css     ✅
│   │   ├── login/page.tsx                         ✅
│   │   ├── signup/page.tsx                        ✅
│   │   ├── dashboard/page.tsx                     ✅
│   │   ├── tournaments/
│   │   │   ├── page.tsx                           ✅
│   │   │   └── [id]/
│   │   │       ├── page.tsx                       ✅
│   │   │       └── predict/
│   │   │           ├── page.tsx                   ✅
│   │   │           ├── BracketPredictor.tsx        ✅ (button visibility bug)
│   │   │           └── actions.ts                 ✅
│   │   ├── leaderboard/page.tsx                   ✅
│   │   ├── leagues/
│   │   │   ├── page.tsx                           ✅
│   │   │   ├── new/page.tsx + actions.ts           ✅
│   │   │   ├── [id]/page.tsx                      ✅
│   │   │   └── join/page.tsx + actions.ts          ✅
│   │   ├── auth/callback/route.ts                 ✅
│   │   ├── auth/logout/route.ts                   ✅
│   │   └── api/cron/
│   │       ├── sync-tournaments/route.ts           ✅ tested
│   │       ├── sync-draws/route.ts                 ✅ tested
│   │       ├── sync-results/route.ts               ✅ written
│   │       └── award-points/route.ts               ✅ tested
│   ├── components/Nav.tsx                         ✅ written (not yet used by all pages)
│   ├── lib/supabase/ (client, server, admin, middleware) ✅
│   ├── lib/tennis/ (adapter, types, points, api-tennis provider) ✅
│   ├── middleware.ts                               ✅
│   └── types/database.ts                          ✅
└── supabase/migrations/001_initial_schema.sql      ✅ run
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

**Important notes:**
- Use NEW publishable/secret keys (JWT was rotated — old anon/service_role keys are dead)
- League create/join uses admin client to bypass RLS (auth session doesn't flow correctly with new key format from client-side)
- CSS variables work via globals.css — do NOT add more CSS after the existing content

---

## Tennis API

Provider: Tennis API - ATP WTA ITF by Matchstat (RapidAPI BASIC free tier)
Host: `tennis-api-atp-wta-itf.p.rapidapi.com`
Endpoints:
- `tennis/v2/{type}/tournament/calendar/{year}` → season calendar
- `tennis/v2/{type}/fixtures/tournament/{id}` → draw + results
roundId: 1=F, 2=SF, 3=QF, 4=R16, 5=R32, 6=R64, 7=R128
Rate limit: sequential requests with 500ms delay between ATP/WTA calls.

---

## Test data in DB

Japan Open Tennis Championships - Tokyo (`id: 5f21f18e-5e6b-4b72-804a-3c114a5f8022`):
- Status: `accepting_predictions`
- Mock draw: QF matches (Alcaraz, Sinner, Zverev, Medvedev)
- Mock result: Alcaraz won QF (match_results table)
- test_account_2 has a locked prediction with 29 pts earned

---

## Immediate next steps (in order)

### Step 1 — Fix predict page button visibility (known bug)
File: `src/app/tournaments/[id]/predict/BracketPredictor.tsx`
The "Submit & lock picks" button exists at bottom of page but may still not be visible.
Root cause: likely a CSS overflow/clipping issue on the nav or page container.
Fix approach: ensure the bottom submit area has explicit padding and is not clipped.

### Step 2 — Sync league points with global points
When a user earns points globally, their league_members.total_points should also update.
Update `src/app/api/cron/award-points/route.ts` to also update league_members:
```ts
// After updating users.total_points, also update league_members
const { data: memberships } = await admin
  .from('league_members')
  .select('league_id')
  .eq('user_id', userId)

for (const m of memberships ?? []) {
  await admin.rpc('increment_user_points', ...) // need a separate league version
}
```
Or simpler: add a DB trigger that propagates point_ledger inserts to league_members.

### ~~Step 3 — Deploy to Vercel~~ ✅ DONE
Live at https://quiet-please.vercel.app
- Cron jobs run daily (Hobby plan limit — upgrade to Pro for sub-hourly)
- `NEXT_PUBLIC_SITE_URL` set in Vercel env vars
- Supabase redirect URLs updated

### ~~Step 4 — User profile page~~ ✅ DONE
File: `src/app/profile/[username]/page.tsx`
- Query user by username
- Show: total points, global rank, tournaments predicted, accuracy stats
- List of predictions with points earned per tournament

### ~~Step 5 — Google OAuth~~ ✅ DONE
- Google Cloud Console credentials created and linked to Supabase
- Login and signup pages already had `signInWithOAuth` wired up
- Working in production
- Add Supabase callback URL to Google's allowed redirects
- Add Client ID and Secret to Supabase

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

CSS variables in `src/app/globals.css` (Tailwind v4 format — @imports must be first):
- `--court` #1a6b3c — primary green
- `--court-dark` #0f4a29 — dark green
- `--chalk` #f5f2eb — page background
- `--chalk-dim` #e8e3d8 — borders
- `--ink` #0d0d0d — primary text
- `--muted` #6b6b6b — secondary text
- Fonts loaded via `<link>` in layout.tsx: DM Serif Display, DM Sans, DM Mono

## Repository
https://github.com/matiasducos/quiet-please