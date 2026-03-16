# Developer Handoff — Quiet Please

## Current status (as of March 16, 2026 — Session 8)

The app is live in production. Session 8 added email confirmation, Google OAuth username-pick flow, full 2026 ATP/WTA calendar (250+), past tournament backfill + practice mode, and fixed the sync-tournaments status reset bug.

### What is working right now
- ✅ Landing page with full design system (chalk bg, court green, DM Serif Display)
- ✅ Auth — signup, login, logout, route protection
- ✅ Email confirmation — signup redirects to /check-email, user clicks link to activate
- ✅ Google OAuth — login/signup with Google, new OAuth users redirected to /setup-username
- ✅ Username setup — /setup-username page for OAuth users who need to pick a username
- ✅ Dashboard — username, points, upcoming tournaments
- ✅ Tournament list (`/tournaments`) — ATP/WTA tabs, real data from API
- ✅ Tournament detail (`/tournaments/[id]`) — draw status, points breakdown, predict/practice buttons
- ✅ Bracket predictor (`/tournaments/[id]/predict`) — pick winners per round, save draft, submit & lock
- ✅ Practice mode — completed tournaments show "Practice picks" button, picks scored immediately against actual results, no real points awarded
- ✅ Leaderboard (`/leaderboard`) — global rankings, current user highlight, medal emojis
- ✅ Leagues (`/leagues`) — create, join with invite code, per-league leaderboard
- ✅ Full 2026 ATP/WTA 250+ calendar seeded in DB (ATP 250+, WTA 250+)
- ✅ Cron: sync-tournaments, sync-draws, sync-results, award-points — all working
- ✅ award-points cron now skips practice predictions (`is_practice = true`)
- ✅ Points engine tested — 29 pts awarded for correct QF pick, showing in nav and leaderboard
- ✅ CSS variables fixed — all buttons, colors, fonts working across entire app
- ✅ League points synced — award-points cron propagates to league_members.total_points
- ✅ User profile page (`/profile/[username]`) — points, rank, hit rate, predictions history
- ✅ Leaderboard usernames link to profile pages
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
│   │   ├── check-email/page.tsx                         ✅ NEW
│   │   ├── setup-username/page.tsx + actions.ts         ✅ NEW (OAuth username pick)
│   │   ├── dashboard/page.tsx                           ✅
│   │   ├── tournaments/
│   │   │   ├── page.tsx                                 ✅
│   │   │   └── [id]/
│   │   │       ├── page.tsx                             ✅ (practice button for completed)
│   │   │       └── predict/
│   │   │           ├── page.tsx                         ✅ (allows completed tournaments)
│   │   │           ├── BracketPredictor.tsx             ✅ (isPractice prop + practice UI)
│   │   │           └── actions.ts                       ✅ (isPractice scoring)
│   │   ├── leaderboard/page.tsx                         ✅
│   │   ├── leagues/
│   │   │   ├── page.tsx                                 ✅
│   │   │   ├── new/page.tsx + actions.ts                ✅
│   │   │   ├── [id]/page.tsx                            ✅
│   │   │   └── join/page.tsx + actions.ts               ✅
│   │   ├── auth/callback/route.ts                       ✅
│   │   ├── auth/logout/route.ts                         ✅
│   │   └── api/cron/
│   │       ├── sync-tournaments/route.ts                ✅ (ignoreDuplicates bug fixed)
│   │       ├── sync-draws/route.ts                      ✅
│   │       ├── sync-results/route.ts                    ✅
│   │       ├── sync-backfill/route.ts                   ✅ NEW (on-demand past tournament backfill)
│   │       └── award-points/route.ts                    ✅ (skips is_practice predictions)
│   ├── components/Nav.tsx                               ✅
│   ├── lib/supabase/ (client, server, admin, middleware) ✅ (middleware checks username_is_set)
│   ├── lib/tennis/ (adapter, types, points, api-tennis provider) ✅
│   ├── middleware.ts                                    ✅
│   └── types/database.ts                               ✅ (updated: is_practice, username_is_set)
└── supabase/migrations/
    ├── 001_initial_schema.sql                           ✅ run
    ├── 002_seed_tournaments.sql (if any)
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

## Phase 4 — Planned frontend changes (not yet started)

These are the next set of improvements to work on, roughly in priority order:

### UX improvements
- Mobile responsive layouts (currently desktop-first) — Nav, bracket predictor, tournament cards
- Better empty states — no predictions, no leagues, no completed tournaments
- Loading skeletons for data-heavy pages

### Tournament improvements
- Show actual results overlaid on bracket predictor for completed/in-progress tournaments
- Color code picks: green = correct, red = wrong, grey = pending
- Tournament card filtering on /tournaments page (filter by surface, tour)

### Notifications
- Email notifications when draw opens (predictions available)
- Email notifications when points are awarded
- In-app notification dot in Nav

### SEO & discoverability
- Static tournament pages (ISR) for better SEO
- Open Graph images for sharing prediction results
- `/tournaments` page accessible without login (just read-only)

### Social
- Share your bracket as an image/link
- See friends' predictions after draw closes
- League activity feed

### Admin
- Admin panel for manually triggering syncs
- Override tournament status
- View all predictions for a tournament

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
