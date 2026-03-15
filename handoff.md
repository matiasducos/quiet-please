# Developer Handoff — Quiet Please

## Current status (as of March 15, 2026)

The project is in early foundation stage. The app scaffolds, runs, and displays a working landing page. Auth pages exist but are not yet wired to a live Supabase instance with tables. No real features (bracket prediction, tournaments, leaderboards) are built yet.

### What is working right now
- Next.js 16 app boots and serves pages at localhost:3000
- Landing page (`/`) renders with full design system (DM Serif Display + DM Sans + DM Mono, court green palette)
- `/login` and `/signup` pages render with full UI (not yet tested end-to-end with Supabase)
- `/auth/callback` route handler exists
- `/dashboard` placeholder page exists (redirects to login if unauthenticated)
- Supabase browser/server/admin clients are wired up
- Next.js middleware handles route protection (redirects unauthenticated users from protected routes to /login)
- Tennis data adapter scaffold is complete (api-tennis.com provider implemented, Sportradar stub ready)
- Full TypeScript database types in `src/types/database.ts`
- ATP/WTA points table constants in `src/lib/tennis/points.ts`
- DB migration SQL written (`supabase/migrations/001_initial_schema.sql`) — **NOT YET RUN on Supabase**

### What is NOT done yet
Everything in the roadmap from Phase 1 step 4 onward.

---

## Project structure

```
quiet-please/
├── docs/
│   ├── architecture.md       ← system design, decisions
│   ├── database.md           ← full schema reference
│   ├── api-adapter.md        ← tennis data layer docs
│   ├── roadmap.md            ← phases and decisions log
│   └── handoff.md            ← this file
├── src/
│   ├── app/
│   │   ├── layout.tsx        ← root layout
│   │   ├── page.tsx          ← landing page ✅
│   │   ├── globals.css       ← design system + CSS vars
│   │   ├── login/page.tsx    ← login page ✅ (UI only)
│   │   ├── signup/page.tsx   ← signup page ✅ (UI only)
│   │   ├── dashboard/page.tsx ← dashboard placeholder ✅
│   │   └── auth/callback/route.ts ← OAuth callback ✅
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts     ← browser Supabase client
│   │   │   ├── server.ts     ← server Supabase client
│   │   │   ├── admin.ts      ← service role client (server only)
│   │   │   └── middleware.ts ← session refresh + route protection
│   │   └── tennis/
│   │       ├── index.ts      ← public adapter interface
│   │       ├── types.ts      ← internal normalised types
│   │       ├── points.ts     ← ATP/WTA points constants
│   │       └── providers/
│   │           ├── base.ts       ← abstract provider class
│   │           ├── api-tennis.ts ← api-tennis.com implementation ✅
│   │           └── sportradar.ts ← Sportradar stub (not implemented)
│   ├── middleware.ts          ← Next.js route protection
│   └── types/
│       └── database.ts        ← TypeScript types mirroring DB schema
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql ← full DB migration (NOT YET RUN)
├── .env.local                 ← local secrets (NOT committed)
├── .env.example               ← env var template
└── setup-pages.sh             ← helper script (can be deleted)
```

---

## Environment variables

File: `.env.local` (already exists on dev machine, NOT in git)

```
NEXT_PUBLIC_SUPABASE_URL=https://nqmjrwqcqnxoocodgedj.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<secret key from Supabase dashboard>
TENNIS_API_KEY=3c017f23c4mshcb90a92890cb23dp103ec3jsn3367cf2e71d1
TENNIS_API_PROVIDER=api-tennis
```

**Important:** The original service role key was accidentally exposed in chat and the JWT secret was rotated. New keys are in the Supabase dashboard under Settings → API Keys.

---

## Pending decisions (questions for the product owner)

### Auth & users
1. Should Google OAuth be enabled? (Requires setting up OAuth credentials in Supabase dashboard → Auth → Providers → Google)
2. Should email confirmation be required on signup, or allow immediate access?
3. Should there be a username uniqueness check on the frontend before form submission, or just rely on DB constraint error?

### Tournaments & draws
4. Should the app cover ATP Challenger events, or only ATP main tour + WTA?
5. Should qualifying rounds be included in predictions, or only main draw?
6. When a tournament has no draw yet (e.g. 3 weeks away), should it appear in the app at all? If yes, in what state?
7. What is the exact "draw close" time rule? (e.g. 1 hour before first match? At official draw ceremony?)

### Predictions
8. If a player retires during a match mid-tournament, how should that be handled — does the user who picked them lose points, or is it voided?
9. Should users be able to see OTHER users' predictions after predictions lock? Or only after the tournament ends?
10. Should there be a "public" vs "private" prediction mode?

### Leagues & challenges
11. What is the maximum size of a private league?
12. Can a user be in multiple leagues simultaneously?
13. For season-long group challenges — does the group automatically include all tournaments, or can the group admin choose which tournaments count?
14. Should there be a league admin role with extra permissions (remove members, etc.)?

### Points & leaderboards
15. Should the global leaderboard be all-time cumulative, or reset per season (calendar year)?
16. Should there be separate leaderboards per tour (ATP-only, WTA-only) or always combined?
17. Should points earned in private leagues count toward the global leaderboard, or be separate?

### Monetisation (for future planning)
18. What is the intended monetisation model? (Paid leagues, subscriptions, ads, sponsorship?)
19. Should there be a free tier with limited tournaments per season?

---

## Immediate next steps (in order)

### Step 1 — Run the DB migration
Go to Supabase dashboard → SQL Editor → New query.
Paste the full contents of `supabase/migrations/001_initial_schema.sql` and run it.
This creates all tables, RLS policies, indexes, and the auto-user-creation trigger.

### Step 2 — Enable Google OAuth (optional but recommended)
- Go to Supabase → Authentication → Providers → Google
- Create OAuth credentials at console.cloud.google.com
- Add the Supabase callback URL to Google's allowed redirects

### Step 3 — Test auth end-to-end
- Create a test account via `/signup`
- Verify the user appears in Supabase → Authentication → Users
- Verify a row is created in the `users` table (via the trigger)
- Verify `/dashboard` is accessible after login
- Verify `/dashboard` redirects to `/login` when not authenticated

### Step 4 — Build tournament list page
File: `src/app/tournaments/page.tsx`
- Server component that reads from `tournaments` table
- For now, seed a few tournaments manually in Supabase SQL Editor
- Show ATP and WTA tabs
- Each card shows: name, tour, category, surface, dates, status badge
- Link to `/tournaments/[id]` (detail page, not yet built)

### Step 5 — Build the draw sync cron job
File: `src/app/api/cron/sync-draws/route.ts`
- Uses `tennisAdapter.getUpcomingTournaments()` 
- Upserts tournaments into `tournaments` table
- For each tournament, calls `tennisAdapter.getDraw()` and upserts into `draws` table
- Protected with `CRON_SECRET` env var
- Deploy as Vercel cron or Supabase Edge Function

### Step 6 — Build bracket prediction UI
File: `src/app/tournaments/[id]/predict/page.tsx`
- Read draw from `draws` table
- Render bracket round by round
- User clicks a player name to pick them as winner
- Picks cascade: if you pick player A in R64, they automatically appear as the opponent's opponent in R32
- Save to `predictions` table as JSONB
- Lock form when `tournament.draw_close_at` has passed or `prediction.is_locked = true`

### Step 7 — Build result sync + points engine
Files:
- `src/app/api/cron/sync-results/route.ts` — polls API for completed matches, writes to `match_results`
- `src/app/api/cron/award-points/route.ts` — compares predictions vs results, writes to `point_ledger`, updates `users.total_points`

### Step 8 — Build global leaderboard
File: `src/app/leaderboard/page.tsx`
- Query `users` ordered by `total_points` DESC
- Show rank, username, avatar, total points, tournaments played

### Step 9 — Build leagues
Files:
- `src/app/leagues/page.tsx` — list user's leagues
- `src/app/leagues/new/page.tsx` — create league form
- `src/app/leagues/[id]/page.tsx` — league detail + leaderboard
- `src/app/leagues/join/[code]/page.tsx` — join via invite code

### Step 10 — Build user profile
File: `src/app/profile/[username]/page.tsx`
- Show username, avatar, total points, global rank
- Tournament history with points earned per tournament
- Prediction accuracy stats (% correct per round)

---

## Tech stack summary

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | Turbopack in dev |
| Styling | Tailwind CSS + CSS variables | Design system in globals.css |
| Database | Supabase (PostgreSQL) | Project: quiet-please |
| Auth | Supabase Auth | Email + Google OAuth (Google not yet configured) |
| Tennis data | api-tennis.com via RapidAPI | Free tier, 200 req/day. Adapter ready to swap to Sportradar |
| Hosting | Vercel (planned) | Not yet deployed |
| Background jobs | Not yet implemented | Plan: Vercel cron or Supabase Edge Functions |

## Design system

CSS variables defined in `src/app/globals.css`:
- `--court` (#1a6b3c) — primary green, buttons, accents
- `--court-dark` (#0f4a29) — dark green, signup panel
- `--clay` (#c8530a) — orange accent
- `--chalk` (#f5f2eb) — page background (warm off-white)
- `--ink` (#0d0d0d) — primary text
- `--muted` (#6b6b6b) — secondary text
- Fonts: DM Serif Display (headings), DM Sans (body), DM Mono (labels/codes)

## Repository
https://github.com/matiasducos/quiet-please
