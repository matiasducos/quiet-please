# Quiet Please — Feature Backlog

> Mark items ✅ as they ship. Add date completed.

---

## In Progress / Next Up

### Facebook OAuth Setup (manual — Matias)
- Code side done ✅ — button added to login & signup pages
- **TODO:** Create Facebook App at developers.facebook.com (Consumer type)
- **TODO:** Enable Facebook Login product, set redirect URI: `https://<project>.supabase.co/auth/v1/callback`
- **TODO:** Copy App ID + App Secret → Supabase Dashboard → Auth → Providers → Facebook → Enable + paste
- **TODO:** Set Facebook app to **Live mode** (not development)

### Automated Match Result Syncing
- Sync match results from api-tennis into the DB automatically
- Previous attempt (10 commits) rolled back 2026-03-24 — issues with player name matching, round normalization, and API field mapping
- Needs: reliable player matching strategy, proper round mapping, robust error handling

---

### Internationalization (i18n / Translation)
- ~139 files with hardcoded English strings, zero i18n infrastructure today
- Recommended library: `next-intl` (built for App Router, TypeScript support, locale routing)
- Scope: 90–150 hours for full extraction + infrastructure + first language
- Strategy: defer until international expansion is closer; then extract in a single 2–4 week sprint
- Dynamic content adds complexity: status labels, notification templates, `timeAgo()`, pluralization

---

## Queued (Not Yet Scoped)

### Season-Long Narrative in Notifications
- "You're currently ranked #47 — Wimbledon starts in 8 weeks and 2,400 points are on the table"
- Personalized ranking + upcoming tournament digest

### Social Sharing (post T&C)
- "Share my bracket" → generates an image card
- Per-tournament page public with top picks, current standings (SEO surface)
- Dynamic social card per prediction

### Referral Mechanics
- "Bring 3 friends to your league and unlock X"
- Future growth iteration

### Email Capture for Anonymous Users
- On anonymous challenge completion: "Save your score — enter your email"
- Re-engagement path for users who play without signing up

### ✅ Season Reset + Surface Filters (Leagues) — 2026-03-27
- `season_start_date` column + 52-week rolling window (whichever is more recent)
- Owner can reset season in settings → standings go to zero
- `allowed_surfaces` column: filter leagues by hard/clay/grass
- Both recalculation functions updated
- Migration: `032_league_seasons_surfaces.sql`

---

## Completed ✅

- ✅ Sentry error monitoring: client + server + edge + cron jobs, global error boundary, tunnel route — 2026-03-26
- ✅ H2H side drawer on bracket cards (mock data, DSG API ready) — 2026-03-26
- ✅ Activity feed mobile truncation fix — 2026-03-26
- ✅ ATP/WTA copy rewrite (avoid implying official affiliation) — 2026-03-26
- ✅ Draw Results page (bracket UI with real winners) + Upcoming Matches page + tournament header buttons — 2026-03-25
- ✅ Legal infrastructure: Privacy Policy, Terms of Service, signup consent, email unsubscribe, Footer — 2026-03-25
- ✅ Security hardening: headers (HSTS, X-Frame-Options, nosniff, Permissions-Policy), CSP report-only, npm audit fix — 2026-03-25
- ✅ Remove `typescript.ignoreBuildErrors` — fixed all 24 type errors, build now type-checks clean — 2026-03-25
- ✅ Security audit: middleware routes, secrets hygiene, rate limiting, dev-only bypasses documented — 2026-03-25
- ✅ Live Right Now sections (dashboard, tournaments page, homepage grid) — 2026-03-25
- ✅ Leaderboard: show all players (including 0 pts), location nudge banner — 2026-03-25
- ✅ Profile: prominent location setup banner — 2026-03-25
- ✅ Facebook OAuth button + Google button restyle — 2026-03-25
- ✅ Anonymous challenges (`/c/[code]`) — 2026-03-23
- ✅ Auth gates on leaderboard, leagues, challenges — 2026-03-23
- ✅ Homepage: live section, features redesign, bracket preview, leaderboard teaser — 2026-03-23
- ✅ Leaderboard blurred preview for anonymous users — 2026-03-23
- ✅ Dynamic OG images for challenge pages — 2026-03-23
- ✅ Friends Activity Feed (shared utility, dashboard + friends + profile pages, limit 15) — 2026-03-23
- ✅ Challenge Rivalry / Head-to-Head Stats (profile page) — 2026-03-23
- ✅ Onboarding Flow — `/welcome` page, video placeholder, post-signup redirect — 2026-03-23
- ✅ Homepage features section — new title, card order, mixed colors, updated copy — 2026-03-23
- ✅ Profile stats boxes centered (matches dashboard style) — 2026-03-23
