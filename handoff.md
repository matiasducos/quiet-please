# Developer Handoff — Quiet Please

## Current status (as of March 18, 2026 — Session 17)

The app is live in production. All Phase 4–7 features are complete. All pending DB migrations (003, 004, 007) are now applied to production. Phase 5 UX polish (skeletons, empty states, admin enhancements, analytics) is done.

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
- ✅ Leaderboard (`/leaderboard`) — worldwide / country / city scopes; ATP / WTA / both circuit filter; rolling 52-week ranking_points; "my rank" highlight; medal emojis
- ✅ Leagues (`/leagues`) — create, join with invite code, per-league leaderboard + activity feed (join / locked picks / points events)
- ✅ Friends system (`/friends`) — search by username, send/accept/decline requests, challenge button; feedback messages via URL params (green/red banners); accessible from own profile page
- ✅ Challenges (`/challenges`) — hub showing pending/active/past challenges, grouped by state
- ✅ New challenge flow (`/challenges/new`) — 2-step: pick friend → pick tournament
- ✅ Challenge detail (`/challenges/[id]`) — accept/decline, live lock status, completed result banner (win/loss/draw)
- ✅ User profile page (`/profile/[username]`) — ranking_points + ATP/WTA circuit breakdown; country/city display + inline edit form (`?edit=location`); rank, hit rate, predictions history, challenges section; "Friends →" link on own profile; contextual friend button on other profiles (Add / Request sent / Accept+Decline / Friends ✓)
- ✅ ATP-style ranking system — rolling 52-week window; weekly slot enforcement (one ATP + one WTA slot per ISO week per user); `ranking_points` / `atp_ranking_points` / `wta_ranking_points` columns on users; Grand Slams consume both ISO weeks they span; slot conflict shown server-side before bracket loads
- ✅ Notifications (`/notifications`) — in-app notification dot in Nav, notifications page
- ✅ Email notifications — draw opens + points awarded emails
- ✅ Open Graph images — `/tournaments/[id]/opengraph-image.tsx`, tier/surface badges, tournament name, date range
- ✅ Admin panel (`/admin`) — trigger sync-tournaments, sync-draws, sync-results, award-points, sync-backfill; tournament status override (force in_progress/completed without waiting for sync); protected by ADMIN_USER_IDS env var; "Admin" link shown in Nav for admin users
- ⚠️ 2026 ATP/WTA calendar incomplete — current free-tier API (api-tennis.com via RapidAPI) only returns a subset of events; 250-level events are missing because they're not included in the free plan. **Upgrade path**: api-tennis.com direct subscription (Starter $40/mo, 14-day free trial). Before paying, email contact@api-tennis.com to confirm ATP/WTA 250 coverage. The adapter layer is already built — only `TENNIS_API_KEY` env var + base URL need changing. No code changes required.
- ✅ Cron: sync-tournaments, sync-draws, sync-results, award-points, sync-backfill — all working; award-points also scores + expires challenges
- ✅ Points engine tested — awards correct per-round points, showing in nav and leaderboard
- ✅ League points synced — award-points cron propagates to league_members.total_points
- ✅ Mobile responsive layouts — Nav (admin/sign-out on mobile tab row), BracketPredictor banners, tournament detail h1
- ✅ ATP Tour-style tournament cards — tier badges, country flags, date ranges
- ✅ Tournament list grouped by month — collapsed by default, chevron expand/collapse, shadow on header to signal clickability
- ✅ City dropdown on profile location form — populated based on selected country (47 countries × 5-15 cities each), client component with key-reset trick
- ✅ Points removed from Nav — already visible on leaderboard and profile
- ✅ Deployed to production at https://quiet-please.vercel.app
- ✅ Vercel cron jobs configured (daily schedules — Hobby plan limit)
- ✅ Supabase Auth redirect URLs updated for production
- ✅ Vercel Analytics — page view tracking via `@vercel/analytics`; `<Analytics />` in root layout

### Known bugs / tech debt
- TypeScript build errors suppressed via `ignoreBuildErrors: true` — fix properly by running `supabase gen types typescript` to regenerate DB types after applying migrations
- Cron schedules are daily-only (Vercel Hobby plan limit) — upgrade to Vercel Pro ($20/mo) for sub-hourly syncs (sync-results every 30 min, award-points every 35 min). **Only matters when going fully public with live tournament data.**

### Pending manual steps (must do before public launch)
1. ✅ **Apply migrations** — `003_username_setup.sql`, `004_practice_predictions.sql`, `007_ranking_system.sql` all run on prod (Session 17)
2. ✅ **Re-enable email confirmation** — done (Session 17)
3. **Run sync-backfill** to process past 2026 tournaments: `GET /api/cron/sync-backfill` with `Authorization: Bearer <CRON_SECRET>` (one-time, run whenever new past tournaments are seeded)

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
│   │   ├── admin/page.tsx + AdminPanel.tsx              ✅ (protected, 5 cron triggers, status override)
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
│   │   │   ├── loading.tsx                              ✅
│   │   │   ├── new/page.tsx + actions.ts                ✅
│   │   │   ├── [id]/page.tsx                            ✅ (leaderboard + activity feed)
│   │   │   ├── [id]/loading.tsx                         ✅
│   │   │   └── join/page.tsx + actions.ts               ✅
│   │   ├── friends/
│   │   │   ├── page.tsx                                 ✅ (search, send/accept/decline, challenge btn)
│   │   │   └── actions.ts                               ✅
│   │   ├── challenges/
│   │   │   ├── page.tsx                                 ✅ (hub: pending/active/past)
│   │   │   ├── new/page.tsx + actions.ts                ✅ (2-step: friend → tournament)
│   │   │   └── [id]/page.tsx + actions.ts               ✅ (detail, accept/decline, result)
│   │   ├── profile/
│   │   │   ├── [username]/page.tsx                      ✅ (ranking_points, ATP/WTA breakdown, country/city edit, challenges)
│   │   │   └── actions.ts                               ✅ (updateLocation server action)
│   │   ├── auth/callback/route.ts                       ✅
│   │   ├── auth/logout/route.ts                         ✅
│   │   └── api/
│   │       ├── admin/
│   │       │   └── set-tournament-status/route.ts       ✅ (auth-protected; force tournament status)
│   │       └── cron/
│   │           ├── sync-tournaments/route.ts             ✅
│   │           ├── sync-draws/route.ts                   ✅
│   │           ├── sync-results/route.ts                 ✅
│   │           ├── sync-backfill/route.ts                ✅
│   │           └── award-points/route.ts                 ✅ (stamps expires_at, calls recalculate_ranking_points)
│   ├── components/Nav.tsx                               ✅ (notification dot)
│   ├── lib/supabase/ (client, server, admin, middleware) ✅
│   ├── lib/tennis/ (adapter, types, points, api-tennis provider) ✅
│   ├── lib/utils/iso-week.ts                            ✅ (ISO 8601 week arithmetic, getTournamentISOWeeks)
│   ├── middleware.ts                                    ✅ (checks username_is_set)
│   └── types/database.ts                               ✅
└── supabase/migrations/
    ├── 001_initial_schema.sql                           ✅ run
    ├── 003_username_setup.sql                           ✅ run on prod (Session 17)
    ├── 004_practice_predictions.sql                     ✅ run on prod (Session 17)
    ├── 006_challenges.sql                               ✅ run on prod
    └── 007_ranking_system.sql                           ✅ run on prod (Session 17)
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
ADMIN_USER_IDS=<comma-separated Supabase user UUIDs — leave empty in dev (check skipped)>
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

### 003_username_setup.sql (✅ RUN ON PROD — Session 17)
- Adds `username_is_set boolean NOT NULL DEFAULT true` to `public.users`
- Updates `handle_new_user()` trigger to set `username_is_set = false` for OAuth signups (no username in metadata)
- Existing users (including current Google users) keep `username_is_set = true` via DEFAULT

### 004_practice_predictions.sql (✅ RUN ON PROD — Session 17)
- Adds `is_practice boolean NOT NULL DEFAULT false` to `public.predictions`
- Practice predictions are scored immediately in the server action (not via cron)
- Practice predictions never affect `users.total_points` or `league_members.total_points`

### 006_challenges.sql (RUN ON PROD ✅)
- Adds `friendships` table: `requester_id`, `addressee_id`, status (`pending|accepted|declined`), unique constraint, no-self constraint
- Adds `challenges` table: `challenger_id`, `challenged_id`, `tournament_id`, status (`pending|accepted|declined|expired|completed`), final score columns, `winner_id`
- Both FKs on `challenges` are explicitly named (`challenges_challenger_id_fkey`, `challenges_challenged_id_fkey`) for PostgREST disambiguation
- RLS policies: users can SELECT rows where they are a party; INSERT as requester/challenger; UPDATE as addressee/challenged only

### 007_ranking_system.sql (✅ RUN ON PROD — Session 17)
- Adds `expires_at TIMESTAMPTZ` to `predictions` (stamped = starts_at + 364 days when points first awarded)
- Adds to `users`: `ranking_points INT NOT NULL DEFAULT 0`, `atp_ranking_points INT NOT NULL DEFAULT 0`, `wta_ranking_points INT NOT NULL DEFAULT 0`, `country TEXT`, `city TEXT`
- Creates `weekly_slots` table: `(user_id, circuit, iso_year, iso_week, tournament_id)` with UNIQUE(user_id, circuit, iso_year, iso_week) — enforces one ATP + one WTA slot per ISO week per user
- Creates `recalculate_ranking_points(p_user_id UUID)` SQL function: sums non-expired prediction points separately for ATP and WTA circuits, writes all three columns atomically
- Creates indexes on `predictions.expires_at`, `users.ranking_points DESC`, `users.country`, `users.city`
- Resets all existing points to 0 (was dummy data only)
- **Important**: `ranking_points` replaces `total_points` in all queries — do not use `total_points` in new code

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

## Phase 5 — UX & Infrastructure ✅ (complete as of Session 17)

- ✅ **Mobile responsive layouts** — Nav (admin pill + sign-out hidden on mobile top row; sign-out added to mobile scrollable tab row), BracketPredictor (save draft hidden in sticky nav on mobile; practice + locked banners reflow: badge inline, long text wraps below), tournament detail h1 uses `text-3xl md:text-4xl` responsive sizing
- ✅ **ATP-style ranking system** — rolling 52-week window, weekly slots, circuit breakdown, leaderboard scopes, country/city on profile (Session 15)
- ✅ **Apply pending migrations to prod** — `003_username_setup.sql`, `004_practice_predictions.sql`, `007_ranking_system.sql` all run on production Supabase (Session 17)
- ✅ **Re-enable email confirmation** — done (Session 17)
- ✅ **Tournament status override** — admin panel now lets you force any tournament to in_progress/completed without waiting for sync cron (Session 17)
- ✅ **Loading skeletons** — all data-heavy pages have Suspense-boundary `loading.tsx` files: dashboard, tournaments, tournaments/[id], leaderboard, leagues, leagues/[id] (Session 17)
- ✅ **Vercel Analytics** — page view tracking via `@vercel/analytics`; `<Analytics />` in root layout (Session 17)

### Still pending
- **Complete tournament calendar** — Several tournaments are missing from the DB, including 250-level events (e.g. Houston Open, ATP Indian Wells 250 qualifier, WTA 250s throughout the year) and past Jan–March 2026 events (Australian Open should show as completed). Root cause: `seed-tournaments` route only hardcodes Grand Slams, Masters 1000, and a handful of 500s — no 250-level events were ever seeded. Fix: expand `src/app/api/admin/seed-tournaments/route.ts` to include all ATP 250 + WTA 250/500 events for 2026, plus past Jan–March tournaments. After adding: hit `/api/admin/seed-tournaments`, then run sync-backfill.
- **Upgrade cron schedules** — Vercel Hobby plan limits to daily. Upgrade to Pro ($20/mo) for sub-hourly syncs (results every 30 min, award-points every 35 min). Only matters for live tournament coverage.

### Lower priority / nice to have
- All-time points view alongside rolling 52-week ranking (already stored in `predictions.points_earned` — just needs a different aggregate query)
- Player search / bracket search
- League-level ranking (per-league rolling points)

---

## Phase 6 — Challenge a friend ✅ (complete as of Session 12)

### Product decisions (confirmed)
- **Friend discovery**: friends/follow system built — search by username → send request → accept
- **Challenge multiplicity**: multiple challenges per tournament allowed — each is independent
- **Pick visibility**: hidden until both players have locked their picks
- **Scoring**: same weighted points system as main predictor; player with most points wins the challenge
- **Tie-breaking**: 1st: most points; 2nd: most predictions made; 3rd: draw
- **Challenge timeline**: challenges can be created for `upcoming` or `accepting_predictions` tournaments only
- **Acceptance deadline**: must accept AND submit picks BEFORE the tournament goes `in_progress`. Pending challenges for tournaments that transition to `in_progress` are automatically expired. This prevents the late-acceptor information advantage (knowing early round results).
- **Declining**: challenged user can decline; challenger sees friendly "challenge was not accepted" message
- **Invite link flow (new friends)**: Phase 2 — not yet built
- **Notifications**: Phase 2 — not yet built
- **Challenge history**: embedded in user profile page (`/profile/[username]`)
- **One-sided submission**: challenge still scores based on what was submitted; if one player never submitted, they score 0

### What was built

| Route | Status |
|-------|--------|
| `supabase/migrations/006_challenges.sql` | ✅ written (run on prod manually) |
| `/friends` + `/friends/actions.ts` | ✅ search, send/accept/decline requests |
| `/challenges` | ✅ hub: pending/active/past, grouped by state |
| `/challenges/new` + `/challenges/new/actions.ts` | ✅ 2-step: pick friend → pick tournament |
| `/challenges/[id]` + `/challenges/[id]/actions.ts` | ✅ detail: accept/decline, lock status, result banner |
| `/profile/[username]` | ✅ extended with challenges table (WIN/LOSS/DRAW) |
| `award-points` cron | ✅ now also expires pending + scores completed challenges |
| `Nav.tsx` | ✅ "Challenges" link added between Leagues and Sandbox |

### Key implementation notes

- **FK disambiguation**: `challenges` has two FKs to `users` (`challenger_id`, `challenged_id`). Both constraints are explicitly named in the migration so PostgREST can disambiguate joined queries.
- **Admin client pattern**: All cross-user data (reading opponent profiles, challenge visibility) uses `createAdminClient()` — same as leagues.
- **Challenge scoring in cron**: Appended to `award-points` cron (not a separate endpoint). Reads `predictions.points_earned` after that's been updated, so scores are always current.
- **Expiration at render time**: `/challenges/[id]` also computes `effectiveStatus` at render — if tournament has started but challenge is still `pending` in DB, it shows "expired" immediately without a DB write.

### Phase 2 (not yet built)
- Invite link for non-users → `/challenges/invite/[token]` landing page
- In-app + email notifications for challenge lifecycle events
- Win/loss record on profile

---

## Phase 7 — ATP-style Ranking System ✅ (complete as of Session 15)

### Product decisions (confirmed)
- **Rolling window**: 52 weeks (same as ATP — not a calendar year reset). Points expire 364 days after the tournament starts.
- **Weekly slots**: one ATP slot + one WTA slot per ISO week per user. Submitting picks for a tournament consumes your slot for that week on that circuit.
- **Grand Slams span 2 ISO weeks**: both weeks are consumed on slot reservation.
- **Slot reservation timing**: locked at first pick save (non-revocable). Conflict shown server-side before bracket loads; also caught at submit time in BracketPredictor.
- **Circuit breakdown**: `ranking_points` = ATP + WTA combined; `atp_ranking_points` and `wta_ranking_points` stored separately.
- **Leaderboard scopes**: Worldwide (all users), Country (same country), City (same city). URL-param driven, fully shareable.
- **Location on profile**: country (dropdown, 47 options) + city (text input), inline edit via `?edit=location` — no client component needed.

### What was built

| File | What changed |
|------|--------------|
| `supabase/migrations/007_ranking_system.sql` | New migration — expires_at, ranking_points cols, weekly_slots table, recalculate_ranking_points() SQL fn |
| `src/lib/utils/iso-week.ts` | New — ISO 8601 week arithmetic (Thursday-anchor), getTournamentISOWeeks() |
| `src/app/tournaments/[id]/predict/actions.ts` | SaveResult discriminated union; weekly slot conflict check on first save |
| `src/app/tournaments/[id]/predict/BracketPredictor.tsx` | Slot error banner, handles SaveResult type |
| `src/app/tournaments/[id]/predict/page.tsx` | Server-side slot pre-check before rendering bracket |
| `src/app/api/cron/award-points/route.ts` | Stamps expires_at on first award; calls recalculate_ranking_points() per user |
| `src/app/leaderboard/page.tsx` | Full rewrite — 3 scope buttons, circuit filter, ranking_points |
| `src/app/profile/[username]/page.tsx` | ranking_points + ATP/WTA pills, country/city display + edit form |
| `src/app/profile/actions.ts` | New — updateLocation server action |
| All other app pages | Bulk: total_points → ranking_points in Nav props + select queries |

### Key implementation notes

- **`weekly_slots` UNIQUE constraint**: DB-level enforcement — even if the server action is bypassed, the DB rejects duplicate slot reservations.
- **`SaveResult` discriminated union**: `{ success: true } | { success: false; error: 'slot_taken'; conflictingTournamentName } | { success: false; error: 'unknown'; message }`. Avoids losing structured info vs throwing errors from Server Actions.
- **`upsert` with `ignoreDuplicates: true`**: re-saving a draft for the same tournament is idempotent — won't error or double-book.
- **ISO week edge case**: Thursday-anchor algorithm handles late-December dates that belong to next year's ISO week (e.g., Dec 29, 2025 → ISO week 1 of 2026).
- **`recalculate_ranking_points` called once per user per cron run** — not per match result. Efficient for large prediction volumes.
- **`expires_at` stamped only once** — checked `!pred?.expires_at` before writing, so partial cron re-runs don't reset the expiry.
- **Country/city leaderboard**: only shown if `profile.country` / `profile.city` is set; buttons disabled with tooltip otherwise.

---

## Open product decisions

1. ATP Challengers included or main tour only?
2. Player retires mid-tournament — void pick or loss?
3. Can users see others' picks before draw closes?
4. Max league size?
5. Season-long challenge: all tournaments or admin-selectable?
6. ~~Global leaderboard: all-time or reset per year?~~ — **resolved**: rolling 52-week ATP-style window
7. ~~Separate ATP/WTA leaderboards or combined?~~ — **resolved**: combined leaderboard with circuit filter (ATP / WTA / Both)
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
