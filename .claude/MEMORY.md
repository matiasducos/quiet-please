# Quiet Please — Project Memory

## Critical Rules
- **Mobile first.** Every UI change must be verified at 375px. Write responsive styles mobile-first (`px-4 md:px-8`, not `px-8`). Tables need `overflow-x-auto` wrappers.
- **NEVER implement non-scalable solutions.** The app is targeting 10k+ users shortly. Always use targeted queries (e.g. `recalculate_member_points(league_id, user_id)` not `recalculate_league_points()` for all leagues). Avoid O(n) operations where O(1) is possible.
- **NEVER take shortcuts. Always apply the right fix.** If RLS is blocking a query, fix the RLS policy — don't bypass it with the admin client. If a DB constraint is wrong, write a migration — don't work around it in app code. Shortcuts create security holes, tech debt, and mask real bugs. The admin client should ONLY be used when there is genuinely no auth session (cron jobs, anonymous challenges, webhook handlers).
- **Always destructure `{ data, error }` from Supabase queries and handle errors.** Never use `{ data: myVar }` without checking `error`. PostgREST returns `{ data: null, error }` on failure — with `data ?? []` fallback this silently becomes an empty array. A wrong column name (`created_at` vs `submitted_at`) was invisible for days because the error was swallowed.
- Prefer pushing filters to the database layer. If PostgREST can't filter on nested relations, filter client-side but keep result sets small with LIMIT.
- **NEVER commit directly to main.** Always create a feature branch (e.g. `feat/h2h-drawer`, `fix/activity-truncation`) and push there. Matias will merge to main via PR or manually.
- **Always delete merged branches.** After a branch is merged to main, delete both the local and remote branch (`git branch -d <branch>` + `git push origin --delete <branch>`). Run `git remote prune origin` to clean stale refs.

## Architecture
- Next.js App Router + Supabase (Postgres + Auth + RLS)
- Deployed on Vercel, DB on Supabase cloud
- Supabase project is NOT linked locally (`supabase db push` won't work) — migrations must be run manually in dashboard
- Cron job at `src/app/api/cron/award-points/route.ts` handles points, rankings, league recalculation, and anonymous challenge scoring

## Key Patterns
- **Tournament references always include flag emoji.** Whenever a tournament is displayed (cards, headers, notifications, activity, challenges), show `flag_emoji` before the location. When inserting notification meta, always include `tournament_flag_emoji` alongside `tournament_name` and `tournament_location`.
- Notifications: DB stores raw type + JSON meta → UI maps via `TYPE_META`, `getHref()`, and message templates in `src/app/notifications/page.tsx`
- When adding a new notification type: update DB constraint migration, insert in action, add rendering in 3 places (TYPE_META, getHref, message template)
- League points: `league_members.total_points` recalculated by `recalculate_league_points()` (global, cron) and `recalculate_member_points(league_id, user_id)` (targeted, on join/create)
- Activity feed on league pages respects `allowed_tournament_types` filter
- Use `useFormStatus` (in child component) for form button loading states, not `useState`

## Three Prediction Modes — CORE LOGIC (read this first)

The app has three distinct prediction modes. They score differently, have different eligibility rules, and must never be confused.

---

### 1. 🌍 Global Tournament Prediction
**Who:** Authenticated users only.
**Route:** `/tournaments/[id]/predict` (no `?challenge=` param)
**When predictions are open:** Controlled by the **prediction mode toggle** in admin (`app_settings.prediction_mode`):
- `anytime`: `accepting_predictions` + `in_progress`
- `pre_tournament`: `accepting_predictions` only (safe mode — no real-time API needed)

**One prediction per tour slot per week:** A user can only enter one ATP and one WTA prediction per ISO calendar week. Trying to predict a second tournament in the same slot returns a "slot taken" conflict screen.

**Scoring (cron `award-points`):**
- Base points per round × streak multiplier (consecutive correct picks on the same player compound)
- Stored in `predictions` (no `challenge_id`) + `point_ledger`
- ✅ Affects `users.ranking_points` (global leaderboard)
- ✅ Affects `league_members.total_points` (all leagues user is in)
- ✅ Triggers `points_awarded` notification + email
- Points expire 364 days after tournament `starts_at` (rolling window)

---

### 2. ⚔️ Friends Challenge
**Who:** Two authenticated users who have an accepted friendship.
**Route:** Created via `/challenges/new` → `/tournaments/[id]/predict?challenge=[id]`
**When predictions are open:** **ALWAYS** `accepting_predictions` + `in_progress` — the global prediction mode toggle does NOT apply. This is hardcoded in both `predict/page.tsx` and `predict/actions.ts`.

**One challenge per pair per tournament:** Only 1 active (`pending` or `accepted`) challenge is allowed between any two users for a given tournament at a time. Duplicate attempts return an error.

**Flow:**
1. Challenger picks friend → picks tournament → "Challenge →" → `pending` challenge created + notification sent
2. Challenged user accepts → `accepted`
3. Both make **separate, challenge-specific bracket picks** at `/tournaments/[id]/predict?challenge=[id]` — stored as `predictions` rows with `challenge_id` set (completely separate from their global picks)
4. Either user can voluntarily lock their bracket — locked picks are revealed to the opponent
5. **Poker rule:** opponent's pick count and live score are hidden until both players lock
6. Cron: pending challenges for `in_progress` tournaments are auto-expired. Accepted challenges for `completed` tournaments are finalized: winner = higher `points_earned`; tiebreaker = more picks made; still tied = draw

**Scoring (same cron):**
- Same algorithm as global (base points × streak multiplier)
- Stored in `predictions` (with `challenge_id`) + `point_ledger`
- ❌ Does NOT affect `users.ranking_points`
- ❌ Does NOT affect leagues
- ❌ No points notification/email
- Key files: `src/app/challenges/new/`, `src/app/challenges/[id]/`, `src/app/tournaments/[id]/predict/`

---

### 3. 👻 Anonymous Challenge
**Who:** Anyone — no account required. Identity = display name + token in `localStorage` (key: `qp_challenge_[shareCode]`).
**Route:** Created at `/challenges/create`, played at `/c/[shareCode]`
**When predictions are open:** **ALWAYS** `accepting_predictions` + `in_progress`. Toggle does not apply. Opponent can submit picks as long as the tournament is not `completed`.

**Flow:**
1. Creator picks tournament → enters display name → makes bracket picks → gets shareable `/c/[shareCode]` link
2. Opponent opens link → enters name → makes picks → challenge status → `active`
3. No accept/decline step — opponent just submits directly
4. Picks revealed to both once opponent submits

**Storage:** Picks stored as JSONB on the `challenges` row (`creator_picks`, `opponent_picks`) — NOT in the `predictions` table.
**Auth:** All DB writes use admin client (service role) — no auth session exists.
**Rate limiting:** 3 creations/hour per IP, 10 opponent submissions/hour per IP.

**Scoring (same cron, different code path):**
- `scoreAnonymousPicks()` from `src/lib/tennis/anonymous-scoring.ts` — pure function, same algorithm
- Scores stored as `challenger_points` / `challenged_points` directly on the `challenges` row
- Auto-locks tracked in `creator_pick_locks` / `opponent_pick_locks` on the same row
- When tournament completes: challenge → `completed`. No `winner_id` set (UI derives winner from points comparison)
- ❌ Does NOT affect ranking, leaderboard, or leagues (no user account involved)
- Key files: `src/app/c/actions.ts`, `src/app/c/[code]/`, `src/app/challenges/create/`

---

### Summary table

| | Global | Friends Challenge | Anonymous Challenge |
|---|---|---|---|
| Auth required | ✅ | ✅ | ❌ |
| Prediction window | Toggle-controlled | Always in_progress + accepting | Always in_progress + accepting |
| Max per tournament | 1 per tour/week slot | 1 per pair | Unlimited |
| Picks stored | `predictions` (no challenge_id) | `predictions` (with challenge_id) | JSONB on `challenges` row |
| Affects leaderboard | ✅ | ❌ | ❌ |
| Affects leagues | ✅ | ❌ | ❌ |
| Points notification | ✅ | ❌ | ❌ |
| Scored by cron | ✅ (main path) | ✅ (challenge path) | ✅ (anonymous path) |

---

### Critical rule for future development
**The prediction mode toggle (`canPredictForStatus()`) ONLY gates global tournament predictions.** Both challenge types bypass it. Any new code that calls `canPredictForStatus()` in a challenge context is a bug. The correct pattern:
```ts
const canPredictNow = challengeId
  ? ['accepting_predictions', 'in_progress'].includes(tournament.status)
  : await canPredictForStatus(tournament.status)
```

## Activity Feed (expanded March 24, 2026)
- Shared utility: `src/lib/friends/activity.ts` — exports `getActivity()` (blended: self+friends+tournaments), `getFriendActivity()` (friends-only), `timeAgo()`
- Dashboard uses `getActivity(userId, 8)` — shows own events as "You", tournament status events with 🎾 icon
- `/friends` page and profile page still use `getFriendActivity()` (friends-only)
- `/welcome` now redirects to `/onboarding`; homepage nav has "How it works" link

## Homepage
- Navbar is sticky (`sticky top-0 z-50`) — always visible while scrolling
- Live section has "See all tournaments →" link to `/tournaments`
- Features grid: 6 cards, alternating blue/green backgrounds (`#eef4ff` / `#edf7f0`), `i % 2 === 0` pattern

## Todo Files
- Location: `.claude/todo/` inside the project repo (single source of truth — no root-level todo files)
- `todo.md` — feature backlog
- `optimization_todo.md` — technical debt (cron resilience, real-time, indexes, analytics)
- `onboarding-video-script.md` — script for onboarding video placeholder
- **Rule: mark items ✅ with date as they ship. Always update before ending a session.**
- `vulnerabilities-todo.md` — security/vulnerability tracking
- Docs: `docs/handoff.md` (architecture/status)

## Legal Infrastructure (added March 25, 2026)
- Privacy Policy at `/privacy`, Terms of Service at `/terms`
- Signup/login pages show "By signing up, you agree to our Terms and Privacy Policy"
- Email unsubscribe: `users.email_notifications` (bool) + `users.unsubscribe_token` (uuid)
- One-click unsubscribe via `/api/unsubscribe?token=<uuid>` → sets `email_notifications=false`
- Both email templates (`sendDrawOpenEmail`, `sendPointsAwardedEmail`) require `unsubscribeToken` param
- Cron jobs check `email_notifications !== false` before sending
- Footer component: `src/components/Footer.tsx` — copyright + Terms/Privacy/Contact links
- Operator: Quiet Please, jurisdiction: Latvia, contact: support@quietplease.app
- Production domain: `quietplease.app` (custom domain on Vercel, purchased March 2026)

## Error Monitoring (Sentry) — added March 26, 2026
- `@sentry/nextjs` with Next.js App Router integration
- Config files: `src/instrumentation.ts`, `src/instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- `next.config.ts` wrapped with `withSentryConfig()` — tunnel route at `/monitoring` (bypasses ad blockers)
- `src/app/global-error.tsx` — catches unhandled client errors
- All 5 cron jobs (`award-points`, `sync-tournaments`, `sync-draws`, `sync-results`, `sync-backfill`) have `Sentry.captureException()` in catch blocks
- Sentry DSN in `NEXT_PUBLIC_SENTRY_DSN` env var (also needs to be set in Vercel dashboard)
- Performance tracing disabled (`tracesSampleRate: 0`) — enable later if needed
- Source map uploads: add `SENTRY_AUTH_TOKEN` to Vercel env for readable stack traces
- Dashboard: sentry.io → quiet-please org → javascript-nextjs project
- EU data region (`.de.sentry.io`)

## H2H Feature — added March 26, 2026
- H2H side drawer on bracket match cards, mock data for now
- Data layer: `src/lib/tennis/h2h.ts`
- UI: `src/components/H2HDrawer.tsx` — side drawer with overall record, surface breakdown, last 5 meetings

## Prediction Mode Toggle (app_settings) — added March 28, 2026
- **`app_settings` table** (key/value JSONB store) — migration `035_app_settings.sql`
- Setting: `prediction_mode` → `'anytime'` (default) or `'pre_tournament'`
- **`anytime`**: predictions allowed for `accepting_predictions` + `in_progress` tournaments (original behaviour, requires real-time API for match locking)
- **`pre_tournament`**: predictions only allowed for `accepting_predictions` (safe mode — no real-time API needed, predictions close when first match starts)
- Helper: `src/lib/app-settings.ts` → `getPredictionMode()`, `getPredictableStatuses()`, `canPredictForStatus()` — all cached via `unstable_cache` with `revalidateTag('app-settings')` on admin save
- Admin UI: Settings tab in `/admin` → radio-button toggle with instant effect
- **Gate locations (global predictions only — use `canPredictForStatus()`):**
  1. `tournaments/[id]/predict/page.tsx` — page redirect gate (bypassed when `challengeId` present)
  2. `tournaments/[id]/page.tsx` — "Make Picks" button visibility
  3. `tournaments/[id]/predict/actions.ts` — `savePrediction()` server-side safety check (bypassed when `challengeId` present)
- **Challenge creation gates** (fixed at `['accepting_predictions', 'in_progress']`, toggle-independent):
  4. `challenges/create/[tournamentId]/page.tsx` — friends challenge creation redirect
  5. `c/actions.ts` — anonymous challenge creation
- **Listing pages (use `getPredictableStatuses()`):** `challenges/create/page.tsx`, `challenges/new/page.tsx`, `onboarding/page.tsx`
- **Auto-predict cron** (`api/cron/auto-predict/route.ts`) also respects the mode
- **Intent:** Ship with `pre_tournament` mode for early users. Switch to `anytime` once real-time match API is connected.

## Migrations
- Latest: 035_app_settings.sql
- See `supabase/migrations/` for full history

## Rollback Points
- ~~Pre-auto-results: commit `4136244`~~ — **used 2026-03-24**, rolled back 10 commits of auto-result syncing (player name matching, round normalization, API field issues). Feature re-queued in todo.md.

## Detailed Notes
- [admin-ui-session.md](admin-ui-session.md) — Admin UI notes
