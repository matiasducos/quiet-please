# Quiet Please — Feature Backlog

> Mark items ✅ as they ship. Add date completed.

---

## In Progress / Next Up

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

### Slam landing pages — the biggest organic opportunity
- Evergreen routes per Grand Slam: `/wimbledon-bracket-challenge`, `/us-open-tennis-bracket`,
  `/australian-open-bracket-predictions`, `/roland-garros-draw-predictions`
- These terms spike enormously around each event and are currently held by one-off news
  articles rather than durable product pages — winnable for a small site
- Each page needs its own metadata, FAQPage JSON-LD, and a CTA into that tournament's bracket
- Add them to `src/app/sitemap.ts` once they exist
- Competitor doing this already: bracket.tennis names all four slams in its meta description

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

### Referral Mechanics
- "Bring 3 friends to your league and unlock X"
- Future growth iteration

### Email Capture for Anonymous Users
- On anonymous challenge completion: "Save your score — enter your email"
- Re-engagement path for users who play without signing up

---

## Shipped

### ✅ Qualifier pick resolution + admin points re-run (2026-07-14, PR #37)
- User-reported bug: picking a QUALIFIER placeholder showed "Your pick eliminated" after the draw resolved, and no points were awarded
- sync-draws now remaps picks (incl. downstream rounds) when a qualifier slot resolves to a real player
- Admin → Award Points: per-tournament "Re-run points" (erase ledger/rankings/leagues/trophies, reopen challenges, re-score) — always silent (`?silent=1` on award-points cron, no notifications/emails)
- One-off repair for pre-fix broken picks: `scripts/backfill-qualifier-picks.mjs` (dry-run default) — **still to run for the affected tournament, then silent re-run from admin**
