# Quiet Please — Feature Backlog

> Mark items ✅ as they ship. Add date completed.

---

## In Progress / Next Up

### ✅ Leaderboard 52-week expiry — shipped 2026-08-11 (PRs #121, #122)
Plan: [`leaderboard-expiry-plan.md`](./leaderboard-expiry-plan.md).

`predictions.expires_at` was written correctly, but `recalculate_ranking_points` only
ever ran for users who *earned points in that cron run* — so a dormant user's
`ranking_points` was frozen forever and the rolling window was enforced only against
people still playing. Leagues had the identical freeze.

Shipped: a daily `expire-points` cron; one set-based `apply_point_expiry()`; real ATP
edition-based expiry **derived** each night rather than stamped, so a cancelled or
vanished tournament needs no manual signal; a `points_expired` in-app notification;
all-time points on the profile hero; and admin calendar-gap reminders.

Nothing is ever deleted — `point_ledger` and `predictions.points_earned` stay
untouched; only derived aggregates change. `scripts/verify-point-expiry.mjs` asserts
that as an invariant (60 assertions, throwaway Postgres).

**Migrations 079–082 are all applied to prod.**

⚠️ **Open: the `expire-points` route has never executed against production** — only
its SQL was verified directly. Dated checklist at the top of
[`qa-next.md`](./qa-next.md). A cron that never fires looks exactly like a cron with
nothing to do, and everything here reports zeros until 2027-03-29.

⚠️ **Open: load the 2027 calendar before 2027-03-29.** Edition-based expiry is inert
until a series has a second edition — prod has 35 tournaments, all 2026, and *all 951*
scoring predictions currently ride on missing 2027 editions. Without them the flat
364-day fallback fires, which is correct only if an event genuinely isn't held.
The first `admin_calendar_gap` reminder is due ~2026-12-29.

Resolved along the way:
- ✅ Vercel cron cap — `vercel crons ls` confirms both jobs registered and active
  (`expire-points` 0 4 * * *, `process-deletions` 0 3 * * *). Hobby allows exactly 2,
  so we are **at the cap**; anything new needing a schedule must fold into one of
  these two, or upgrade to Pro.
- ✅ All-time points live on the profile hero **only** — leaderboard, nav and dashboard
  stay on the rolling figure. (`total_points` in league tables is
  `league_members.total_points`, an unrelated per-league column.)

### ✅ Mobile responsiveness audit — no side-scrolling anywhere (2026-08-11)
Swept at 375px, signed in as the QA account. Seven real defects, all fixed:

| surface | was | PR |
|---|---|---|
| `/leaderboard` table | 159px of scroll revealing **blank space** | #117 |
| `/leaderboard` scope control | 4th cell read "My c" | #117 |
| `/leagues/[id]` table | `min-w-[500px]` on 3 always-visible columns | #117 |
| Nav tab strip (site-wide) | ran to x=460; "Challenges" read "Ch" | #118 |
| `/tournaments` filter chips | 626px in 343px — 3 of 6 filters unreachable | this |
| `/admin/…/results` match rows | page overflowed 20px; `Lock` at x=396 | this |
| Round tabs (tournament + predict) | 252px scroll; the **Final** was off screen | this |
| Predict sticky bar | 383px; "Lock all picks" clipped | this |

Clean at 375px: `/`, `/dashboard`, `/challenges`, `/profile/[username]` (+ `?tab=stats`),
`/admin`, `/admin/users`.

**Two horizontal scrollers deliberately kept** — the homepage achievements shelf and the
bracket preview. A bracket is a wide diagram and a shelf is a shelf; scrolling is the
correct affordance for both, and nothing is hidden or unreachable. The rule is aimed at
scrollers that hide *functionality* — filters, navigation, table columns — not at wide
content that announces itself.

**The recurring bug**, worth recognising next time: a container keeps a fixed `min-w-`
or `flex-shrink-0` children while a media query hides or shrinks what is inside it. The
two mechanisms disagree, and the result is a scrollbar leading to dead space or to
content nothing signals is there — every instance above is a variant of it. `scrollbarWidth: 'none'`
made each one worse by removing the only hint that scrolling was possible.

**Second pass (2026-08-12)** finished the remaining routes. Three more defects:

| surface | was |
|---|---|
| `/leagues` action row | "Create league" — the primary action — clipped at x=416 |
| Loading skeletons (4 files) | hardcoded px bars inside flex columns; `/notifications` overflowed to x=397 |
| Recap round table | `min-w-[420px]` forcing scroll on a table that needs ~250px |

Clean: `/signup`, `/login`, `/privacy`, `/terms`, `/friends`, `/notifications` (loaded),
`/us-open-tennis-bracket`, `/tournaments/[slug]/[year]/recap` (page body).
`/c/[code]` was covered during the anonymous-email work.

**Every defect in both passes was one bug**: a fixed width (`min-w-`, an inline `px`, or
`flex-shrink-0`) inside a container that a media query shrinks. The two disagree and the
remainder goes to a scrollbar — or off the edge. When adding a fixed width inside a flex
or grid child, the question to ask is what happens at 375px, and `min-w-0` on the parent
is usually the missing half.

**Still not audited:** the other three slam landing pages (the US Open one is clean and
they share a template), `/activity`, `/onboarding`, `/challenges/[id]`, `/leagues/browse`.

### Facebook OAuth Setup (manual — Matias)
- Code side done ✅ — button added to login & signup pages
- **TODO:** Create Facebook App at developers.facebook.com (Consumer type)
- **TODO:** Enable Facebook Login product, set redirect URI: `https://<project>.supabase.co/auth/v1/callback`
- **TODO:** Copy App ID + App Secret → Supabase Dashboard → Auth → Providers → Facebook → Enable + paste
- **TODO:** Set Facebook app to **Live mode** (not development)

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

### ✅ Copy (2026-08-04)
- Exclamation mark dropped from "Built for every tennis fan"
- Streak multiplier now told once on the page — the `HowItWorksDemo` table, which shows
  the actual +10 → +90 → +540 progression rather than describing it. The bracket-preview
  paragraph lost its trailing streak sentence; features #04 keeps a one-line version.
  **The FAQ JSON-LD copy was left alone on purpose** — it is the answer Google lifts into
  a rich result, where it stands alone and has to be self-contained
- Three "Start predicting" CTAs cut to one. The bracket-preview button now reads
  "See open draws →", which also fixes a label/destination mismatch (it links to
  `/tournaments`, not to a bracket); the final CTA reads "Make your first picks — free"
- Name explained in `Footer.tsx` — "Quiet please" is the umpire's call. Site-wide, not
  just the landing page

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

### Anonymous player follow-ups (after the email capture below)
- **Nothing tells the creator their opponent has accepted.** They leave an address, then
  hear nothing until the tournament ends. A second email at "your opponent submitted,
  the race is on" is the obvious next one, but it breaks the "one email, nothing else"
  promise the capture form makes — changing that promise means changing the copy in
  `AnonymousConversion.tsx`, `/privacy` §7 and the footer in `anonymousFooter()` together
- Measure before adding: the result email carries `?next=/c/<code>` into `/signup`, so
  attribution already distinguishes these signups. Wait for a real conversion rate

---

## Shipped

### ✅ Anonymous → account conversion + email capture (2026-08-10)
- **Why now:** the US Open opens 2026-08-30 and signups were 2 in the preceding 30 days.
  The infrastructure to attract that traffic already existed (slam pages, social cards,
  recaps); the step that turns it into accounts did not
- The ask on `/c/[code]` and the create flow's share step was a small grey outlined link.
  Replaced by one shared block, `src/components/AnonymousConversion.tsx`, used at all
  three anonymous moments: challenge created, opponent submitted, result standing
- Email capture is the point: with no address there was **no way to tell an anonymous
  player they won**, which is the moment that earns the account. Migration `078`;
  `saveAnonymousEmail()` in `src/app/c/actions.ts`
- Purpose-limited by design — one email, and the send **erases the address** in the same
  write that stamps `*_result_emailed_at`. Opt-out is `/api/unsubscribe/anonymous`, which
  erases rather than suppresses (the account unsubscribe route can't serve someone with
  no user row). `/privacy` §2, §3, §7 and §8 updated to match
- Sent from a dedicated retryable pass in `award-points` (§12b) rather than inline with
  scoring, so a Resend failure retries instead of losing the email permanently
- **Also closed a leak this depended on:** `/c/[code]` shipped both raw challenge tokens
  in its RSC payload. Harmless while they only picked which bracket to highlight, not
  harmless once one authorises writing an email address — the page now gets SHA-256
  digests (`src/lib/challenge-token.ts`) and only the raw token reaches server actions

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
