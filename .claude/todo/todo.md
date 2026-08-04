# Quiet Please — Feature Backlog

> Mark items ✅ as they ship. Add date completed.

---

## In Progress / Next Up

### Canadian Open 2026 draw is half entered (found 2026-08-04)
`ce10940c-7a0e-4e7e-beee-c9d90d75a9b9` — National Bank Open, Montreal, `in_progress`.
Measured against production:

| round | matches | slots filled | empty |
|---|---|---|---|
| R128 | 64 | **96** | 32 |
| R64 | 32 | **0** | 64 |
| R32 | 16 | **0** | 32 |
| R16 → F | 15 | **0** | 30 |

- 32 R128 slots were never named — the qualifier slots. The page header says
  "128-PLAYER DRAW" while the panel below reads "96 players"
- 46 of 64 R128 matches have results; 18 are outstanding
- **This is why the tournament shows no upcoming matches** — there is nothing in the
  stored draw past R128 to display. `sync-draws` is idle by design (draws are entered
  by hand), so nothing fills this automatically
- **Open question before the fix:** does the bracket view derive later rounds from
  `match_results`, or read them from the stored draw? If the latter, R64+ needs
  filling by hand as results land. Worth confirming — it changes the amount of work
- Unrelated but surfaced alongside: 3 picks on this draw name `qualifier-N`
  placeholders (R128 matches 027, 058, 059). Per migration 064 these can never score
  and cannot be repaired — the pre-resolution draw is not retained
- A report of every player rendering as "Qualifier" on this tournament could **not** be
  reproduced: `buildMyTournament` against live data returns correct names and the exact
  headline figures. `displayName()` falls back to `'Qualifier'` for the whole list at once
  when the bracket carries no names, so the symptom fits a render from before the draw
  was populated. Re-open if it recurs on a hard refresh


### Mobile responsiveness audit — NO side-scrolling anywhere
- Priority page: `/leaderboard` — user must NEVER have to side-scroll on mobile
- Audit all pages at 375px for horizontal overflow. Currently the leaderboard table is wrapped in `overflow-x-auto` which permits side-scroll as an escape hatch — the real fix is to redesign the row layout so it fits natively at 375px
- Candidate approach: stack rank+avatar+username on the primary line, push points/change to a secondary line below at mobile; revert to single-row grid at `md:` and up
- Check other tables too: `/leagues/[id]`, tournament results, admin tables

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

## Landing Page Improvements (from the 2026-07-30 review)

Tier 1 (SEO plumbing) and Tier 2 (mobile/a11y) shipped in PR #78. Everything below is
what remains, roughly in impact order.

### ✅ Slam landing pages (2026-07-30, PR #79)
- Four evergreen routes live: `/wimbledon-bracket-challenge`, `/french-open-bracket-challenge`,
  `/us-open-tennis-bracket`, `/australian-open-bracket-challenge`
- Per-slam config in `src/lib/slams/config.ts` — palette, copy, facts, FAQ. Adding a fifth
  page is one config entry plus a ~10-line route file
- Four phases (`live`/`open`/`upcoming`/`offseason`) in `src/lib/slams/data.ts`; pages never
  404 so they hold ranking year-round
- Follow-ups below

### Slam pages — follow-ups
- **WTA slam rows don't exist.** The DB has only ATP rows for Wimbledon / Roland Garros /
  US Open, and no Australian Open row at all. Each page renders "The WTA draw appears here as
  soon as it is added" — add the WTA rows via admin to complete them
- **Sync leaves `location`/`flag_emoji` NULL.** `src/app/api/cron/sync-tournaments/route.ts`
  never writes either column, so API-created tournaments lack the flag the project convention
  requires. Landing pages work around it via config; the real fix is in the sync + a backfill
- Consider per-slam hero imagery once the imagery item below is tackled

### Hero: add a product visual + social proof
- The hero is ~640–750px of pure typography; the bracket (the actual product) doesn't appear
  until ~1,500px down. Pull a bracket visual into the hero, right-aligned at `md:` and up
- No social proof anywhere on the page. `getTournamentEngagement()` and `topPlayers` are
  already fetched in `getHomepageData()` — surface "X predictions locked in this week"

### Imagery
- 4 images on the entire page, all country flags. A tennis product with no image of tennis
- One well-chosen court texture or action shot in the hero would change the emotional register

### Colour system is fragmenting
- Features grid hardcodes `#eef4ff` / `#edf7f0`; the achievements section adds ~9 more
  hardcoded hex pairs. None are tokens in `globals.css`
- `--muted` (#6b6b6b) on `--chalk` is 4.76:1 — passes AA but with almost no margin, and most
  body copy sits at 0.875–0.9rem. Darkening to ~#5a5a5a costs nothing

### Copy
- "Built for every tennis fan!" — the only exclamation mark on the page; undercuts the
  restrained editorial tone everything else establishes
- Streak multiplier is explained three separate times (bracket section, how-it-works,
  features #04). "Start predicting" appears 4×
- The name is never explained — "Quiet Please" is the umpire's call. A one-line nod would
  add charm and make the brand stick

### Canonical host hygiene (low priority — canonical tags already mitigate)
- `quiet-please.vercel.app` serves Production, returns 200 and a crawlable `Allow: /`
  robots.txt (correctly — it *is* the production deployment). Duplicate content, but every
  page emits `<link rel="canonical" href="https://quietplease.app">` so Google consolidates
- If belt-and-braces is wanted later: a host check in `proxy.ts` redirecting any non-canonical
  host to `SITE_URL` would cover the `.vercel.app` alias and any future alias in one place
- ✅ www → apex 308 redirect set in Vercel project Settings → Domains (2026-07-30)
- Vercel shows "DNS Change Recommended" on the apex. Site resolves and serves fine
  (`76.76.21.21`, HTTP 200) — do NOT act on this if it means moving nameservers to Vercel;
  DNS is deliberately at Hostinger

### Leaderboard teaser exposes real usernames
- Rows 4–5 are visually blurred with `filter: blur(5px)` but the real usernames sit in the
  DOM in plain text, readable in DevTools. Either render placeholders server-side or accept
  it deliberately

---

## Queued (Not Yet Scoped)

### Season-Long Narrative in Notifications
- "You're currently ranked #47 — Wimbledon starts in 8 weeks and 2,400 points are on the table"
- Personalized ranking + upcoming tournament digest

### Social Sharing (post T&C)
- "Share my bracket" → generates an image card
- Per-tournament page public with top picks, current standings (SEO surface)
- Dynamic social card per prediction
- **Cheaper now**: the admin card renderer (PR #91) already solves fonts, flag
  emoji and the Satori-safe template subset in `src/lib/social/`. A user-facing
  share card is a new template + a public route, not a new pipeline. Note the
  admin route is service-role and admin-guarded — a public one needs its own
  auth story and caching (these are `no-store`).

### Referral Mechanics
- "Bring 3 friends to your league and unlock X"
- Future growth iteration

### Email Capture for Anonymous Users — **next up after PR #101**
- On anonymous challenge completion: "Save your score — enter your email"
- Re-engagement path for users who play without signing up
- Scoped by the 2026-08-04 funnel review: `/c/[code]` is where someone fills out an
  entire bracket from a friend's link — the highest-intent moment in the product — and
  the payoff is one small grey outlined link at the very bottom
  (`ChallengeView.tsx`, the "Create a free account →" block). The anonymous
  `AnonymousCreateFlow` CTA has the same weak treatment
- The email is the other half: with no address captured, there is no way to tell an
  anonymous player they won when results land, which is the natural moment to earn
  the account
- Note `/challenges/[id]` (the signed-in view) now redirects anonymous visitors to
  `/signup?next=…` rather than a bare `/login` — PR #101 fixed the arrival, not the ask

---

## Shipped

### ✅ Acquisition funnel: attribution, consent, signup page (2026-08-04, PR #99)
- **The finding that drove it:** PostHog ran `persistence: 'memory'` to avoid a cookie banner, so the anonymous `distinct_id` was reminted on every full page load. `/` reported 21 persons across 21 sessions; `/admin`, a one-person page, reported 25. Sessions, bounce rate, retention and every multi-step funnel were meaningless
- Server-side first-touch attribution: middleware stamps `qp_attr`, `setUsername()` banks it onto the user row and `signup_completed`. Migration 075. Precedence is `utm_source` → paid click id (`gclid` etc.) → referring domain → direct
- Cookie consent for EEA/UK, failing closed on a missing geo header. Gates `qp_attr` + `qp_ref`; consent unlocks full PostHog persistence — **verified in production that `distinct_id` now survives a full page load**
- Signup page: value panel now shows on mobile (was `hidden lg:flex`), Google above the email form, and the primary CTA no longer renders disabled until consent is ticked
- Privacy policy rewritten — it listed 2 of 6 cookies and omitted PostHog, Sentry and `qp_ref` entirely
- Nav "Get started" wrapped in `TrackedCTA`; `cta_clicked` had never fired once because the busiest path to `/signup` was the only untracked one

### ✅ Duplicate title suffix on 15 pages (2026-08-04, PR #100)
- Root layout's `%s | Quiet Please` template was being doubled by pages that also spelled the suffix out — `Tournaments | Quiet Please | Quiet Please`. 7 of the 15 are crawlable

### ✅ Intent preserved through auth (2026-08-04, PR #101)
- Every gate was a bare `redirect('/login')`; middleware set a `redirectTo` param that `/login` never read
- `next` now survives gate → `/login` or `/signup` → OAuth or the confirmation link → `/auth/callback` → `/setup-username` → destination. The two hops that silently dropped it were the `/setup-username` bounce (fires only for brand-new accounts) and `/signup` hardcoding `next=/dashboard` into the confirmation email
- Content surfaces (predict, shared challenge, tournament leaderboard) now send signed-out visitors to `/signup` rather than `/login`; both pages cross-link carrying `next`
- Open-redirect guard moved to `src/lib/auth-redirect.ts` and now governs every hop

### ✅ Admin social cards for Instagram (2026-08-03, PR #91)
- `/admin/tournaments/[id]/social` — draw published / round recap / champion, each as IG story (1080×1920) and square (1080×1080), downloaded as a real PNG
- Preview and download share one render (blob: URL), so what you approve is the file you get
- Migration 074 `social_match_pick_counts` backs the "% of brackets called it" line off `point_ledger`, scoped to `challenge_id is null`
- **Two gaps this surfaced, both still open**: no draw carries seeds (DrawBuilder never collects them, so the seed badges stay dormant), and 0 of 127 Wimbledon results have a score string (score pills never render). Filling scores at results entry is free content on every recap card.

### ✅ Qualifier pick resolution + admin points re-run (2026-07-14, PR #37)
- User-reported bug: picking a QUALIFIER placeholder showed "Your pick eliminated" after the draw resolved, and no points were awarded
- sync-draws now remaps picks (incl. downstream rounds) when a qualifier slot resolves to a real player
- Admin → Award Points: per-tournament "Re-run points" (erase ledger/rankings/leagues/trophies, reopen challenges, re-score) — always silent (`?silent=1` on award-points cron, no notifications/emails)
- One-off repair for pre-fix broken picks: `scripts/backfill-qualifier-picks.mjs` (dry-run default) — **still to run for the affected tournament, then silent re-run from admin**
