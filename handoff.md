# Developer Handoff — Quiet Please

## Current status (as of March 16, 2026 — Session 11)

The app is live in production. All Phase 4 features are now complete.

### What is working right now
- ✅ Landing page with full design system (chalk bg, court green, DM Serif Display)
- ✅ Auth — signup, login, logout, route protection
- ✅ Email confirmation — signup redirects to /check-email, user clicks link to activate
- ✅ Google OAuth — login/signup with Google, new OAuth users redirected to /setup-username
- ✅ Username setup — /setup-username page for OAuth users who need to pick a username
- ✅ Dashboard — username, points, upcoming tournaments
- ✅ Tournament list (`/tournaments`) — ATP/WTA tabs, surface filters, real data; accessible without login
- ✅ Tournament detail (`/tournaments/[id]`) — public (ISR cached), draw status, points breakdown, predict/practice buttons; "See all picks →" link when in_progress/completed
- ✅ Bracket predictor (`/tournaments/[id]/predict`) — pick winners per round, save draft, submit & lock; sticky header (nav + banner + round tabs)
- ✅ Locked picks view — `predict/page.tsx` shows readOnly bracket with color-coded results + per-match points (`✓ +N pts`) instead of redirecting
- ✅ Practice mode — completed tournaments show "Practice picks" button, picks scored immediately, no real points awarded
- ✅ Public picks page (`/tournaments/[id]/picks/[username]`) — view any user's locked bracket, no auth required; color-coded with results + points
- ✅ All picks listing (`/tournaments/[id]/picks`) — leaderboard of all locked predictions, sorted by points_earned; "View →" links to individual bracket
- ✅ Share picks — "Share picks" button in locked bracket banner copies public link to clipboard
- ✅ Leaderboard (`/leaderboard`) — global rankings, current user highlight, medal emojis
- ✅ Leagues (`/leagues`) — create, join with invite code, per-league leaderboard + activity feed (join / locked picks / points events)
- ✅ User profile page (`/profile/[username]`) — points, rank, hit rate, predictions history
- ✅ Notifications (`/notifications`) — in-app notification dot in Nav, notifications page
- ✅ Email notifications — draw opens + points awarded emails
- ✅ Open Graph images — `/tournaments/[id]/opengraph-image.tsx`, tier/surface badges, tournament name, date range
- ✅ Admin panel (`/admin`) — trigger sync-tournaments, sync-draws, sync-results, award-points, sync-backfill; protected by ADMIN_USER_IDS env var
- ✅ Full 2026 ATP/WTA 250+ calendar seeded in DB
- ✅ Cron: sync-tournaments, sync-draws, sync-results, award-points, sync-backfill — all working
- ✅ Points engine tested — awards correct per-round points, showing in nav and leaderboard
- ✅ League points synced — award-points cron propagates to league_members.total_points
- ✅ ATP Tour-style tournament cards — tier badges, country flags, date ranges
- ✅ Deployed to production at https://quiet-please.vercel.app
- ✅ Vercel cron jobs configured (daily schedules — Hobby plan limit)
- ✅ Supabase Auth redirect URLs updated for production

### Known bugs / tech debt
- TypeScript build errors suppressed via `ignoreBuildErrors: true` — fix properly by running `supabase gen types typescript` to regenerate DB types after applying migrations
- Cron schedules are daily-only (Vercel Hobby plan limit) — upgrade to Vercel Pro ($20/mo) for sub-hourly syncs (sync-results every 30 min, award-points every 35 min). **Only matters when going fully public with live tournament data.**

### Pending manual steps (must do before public launch)
1. **Apply migrations** to production Supabase: `003_username_setup.sql` + `004_practice_predictions.sql`
2. **Re-enable email confirmation** in Supabase dashboard → Auth → Email Provider (code is ready)
3. **Run sync-backfill** to process past 2026 tournaments: `GET /api/cron/sync-backfill` with `Authorization: Bearer <CRON_SECRET>`

---

## Project structure

```
quiet-please/
├── docs/
│   ├── architecture.md, database.md, api-adapter.md, roadmap.md, handoff.md
├── src/
│   ├── app/
│   │   ├── layout.tsx, page.tsx, globals.css            ✅
│   │   ├── login/page.tsx                               ✅
│   │   ├── signup/page.tsx                              ✅ (email confirmation flow)
│   │   ├── check-email/page.tsx                         ✅
│   │   ├── setup-username/page.tsx + actions.ts         ✅ (OAuth username pick)
│   │   ├── dashboard/page.tsx                           ✅
│   │   ├── notifications/page.tsx                       ✅
│   │   ├── admin/page.tsx + AdminPanel.tsx              ✅ (protected, 5 cron triggers)
│   │   ├── tournaments/
│   │   │   ├── page.tsx                                 ✅ (public, ATP/WTA/surface filters)
│   │   │   └── [id]/
│   │   │       ├── page.tsx                             ✅ (ISR, public, "See all picks →")
│   │   │       ├── opengraph-image.tsx                  ✅ (1200×630, tier+surface badges)
│   │   │       ├── picks/
│   │   │       │   ├── page.tsx                         ✅ (all locked picks, sorted by pts)
│   │   │       │   └── [username]/page.tsx              ✅ (public bracket view, color-coded)
│   │   │       └── predict/
│   │   │           ├── page.tsx                         ✅ (locked→readOnly, practice mode)
│   │   │           ├── BracketPredictor.tsx             ✅ (sticky header, per-match pts)
│   │   │           └── actions.ts                       ✅ (isPractice scoring)
│   │   ├── leaderboard/page.tsx                         ✅
│   │   ├── leagues/
│   │   │   ├── page.tsx                                 ✅
│   │   │   ├── new/page.tsx + actions.ts                ✅
│   │   │   ├── [id]/page.tsx                            ✅ (leaderboard + activity feed)
│   │   │   └── join/page.tsx + actions.ts               ✅
│   │   ├── profile/[username]/page.tsx                  ✅
│   │   ├── auth/callback/route.ts                       ✅
│   │   ├── auth/logout/route.ts                         ✅
│   │   └── api/cron/
│   │       ├── sync-tournaments/route.ts                ✅
│   │       ├── sync-draws/route.ts                      ✅
│   │       ├── sync-results/route.ts                    ✅
│   │       ├── sync-backfill/route.ts                   ✅
│   │       └── award-points/route.ts                    ✅ (skips is_practice)
│   ├── components/Nav.tsx                               ✅ (notification dot)
│   ├── lib/supabase/ (client, server, admin, middleware) ✅
│   ├── lib/tennis/ (adapter, types, points, api-tennis provider) ✅
│   ├── middleware.ts                                    ✅ (checks username_is_set)
│   └── types/database.ts                               ✅
└── supabase/migrations/
    ├── 001_initial_schema.sql                           ✅ run
    ├── 003_username_setup.sql                           ✅ written, NOT YET run on prod
    └── 004_practice_predictions.sql                     ✅ written, NOT YET run on prod
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

## Database migrations applied

### 003_username_setup.sql (NOT YET RUN ON PROD)
- Adds `username_is_set boolean NOT NULL DEFAULT true` to `public.users`
- Updates `handle_new_user()` trigger to set `username_is_set = false` for OAuth signups (no username in metadata)
- Existing users (including current Google users) keep `username_is_set = true` via DEFAULT

### 004_practice_predictions.sql (NOT YET RUN ON PROD)
- Adds `is_practice boolean NOT NULL DEFAULT false` to `public.predictions`
- Practice predictions are scored immediately in the server action (not via cron)
- Practice predictions never affect `users.total_points` or `league_members.total_points`

---

## How practice mode works

1. Completed tournaments show a purple "Practice picks →" button on the detail page
2. User goes to `/tournaments/[id]/predict` with `isPractice = true`
3. A purple "PRACTICE MODE" banner explains no points are awarded
4. User picks winners, clicks "Score my picks"
5. Server action fetches `match_results` for the tournament, scores picks against actual results
6. Points are stored in `predictions.points_earned` with `is_practice = true`
7. User is redirected back to tournament detail showing their practice score
8. `award-points` cron skips `is_practice = true` predictions

---

## Phase 4 — Status (all complete as of Session 11)

All originally planned Phase 4 items are now shipped:
- ✅ Color-coded bracket picks (green/red/gold) with per-match points
- ✅ Tournament card filtering (ATP/WTA + surface)
- ✅ Email notifications (draw opens + points awarded)
- ✅ In-app notification dot in Nav
- ✅ ISR-cached public tournament pages
- ✅ Open Graph images
- ✅ `/tournaments` accessible without login
- ✅ Share bracket link
- ✅ Public per-user picks view
- ✅ All-picks leaderboard per tournament
- ✅ League activity feed
- ✅ Admin panel for triggering syncs
- ✅ Sticky bracket header

## Phase 5 — Next things to work on

### High priority
- **Mobile responsive layouts** — Nav, bracket predictor, and tournament cards are desktop-first. BracketPredictor especially needs work at small widths (round tabs overflow, player names truncate badly)
- **Apply pending migrations to prod** — `003_username_setup.sql` and `004_practice_predictions.sql` are written but not yet run on production Supabase
- **Re-enable email confirmation** in Supabase dashboard → Auth → Email Provider (code is ready; was disabled for testing)

### Medium priority
- **Override tournament status** in admin panel — manually set a tournament to in_progress/completed without waiting for sync
- **Better empty states** — no predictions yet, no leagues yet, no completed tournaments
- **Loading skeletons** for data-heavy pages (tournament list, leaderboard)
- **Upgrade cron schedules** — Vercel Hobby plan limits to daily. Upgrade to Pro ($20/mo) for sub-hourly syncs (results every 30 min, award-points every 35 min). Only matters for live tournament coverage

### Lower priority / nice to have
- Global leaderboard: all-time vs per-year toggle
- Separate ATP/WTA leaderboards
- Season-long standings across all tournaments
- Player search / bracket search

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
