# QA — pending checks

## ⚠️ expire-points cron — never verified end to end (PRs #121/#122, 2026-08-11)

**The single untested path in the whole expiry feature.** Every SQL function was
verified directly (60 assertions in `scripts/verify-point-expiry.mjs`, plus dry
runs against prod), and the route was type-checked and linted — but the HTTP
route itself has never actually executed against production. It could not be:
`.env.local` carries the dev `CRON_SECRET`, so the endpoint cannot be
authenticated from a dev machine. Its first real execution is Vercel's own
04:00 schedule.

What that leaves unproven is only the glue — argument marshalling into the RPCs,
the drain loop, the notification insert, the reminder step — not the maths.

### Check this at the next convenient moment

1. `/admin` → **Cron Runs** tab, look for a row with job `expire-points`
   - [ ] A row exists at all. **Missing = the cron is not firing**, which looks
         identical to "nothing to do". This is the whole reason for the flag.
   - [ ] Status `success`, and duration is small (well under 60s)
   - [ ] Summary reads all zeros: `users_updated: 0`, `predictions_marked: 0`,
         `expiry_refreshed: 0`, `resurrected: 0`, `newly_due: 0`,
         `calendar_gaps: 0`, and `drained: true`
   - [ ] **Any non-zero before 2027-03-29 is a real defect** — it would mean the
         derived expiry disagrees with the stored stamps
2. With the production `CRON_SECRET` to hand:
   ```
   curl -s -H "Authorization: Bearer $CRON_SECRET" \
     "https://quietplease.app/api/cron/expire-points?dry=1"
   ```
   - [ ] Returns 200 with the same all-zero shape
   - [ ] `?as_of=2027-06-01&dry=1` reports ~119 users / 479 predictions
   - [ ] `?as_of=2027-06-01` **without** `dry=1` is rejected with 400 (the guard
         that stops a stray date retiring the whole leaderboard)

### Then again around 2026-12-29

The first `admin_calendar_gap` notification is due ~90 days before the earliest
anniversary (2027-03-29).

   - [ ] Admins receive **one** in-app notification, not one per tournament
   - [ ] It does not repeat daily — the re-nag guard is 7 days
   - [ ] It links to `/admin/tournaments/new`
   - [ ] `ADMIN_USER_IDS` is actually populated in production, or nobody is told

### And at 2027-03-29 — the first real expiry

   - [ ] Affected users get a `points_expired` notification, one per user
   - [ ] Leaderboard totals drop and the breakdown drawer shows `EXPIRED` chips
         while still listing the tournament
   - [ ] Profile all-time figure is **unchanged**, and its caption flips from
         "nothing expired yet" to "never expires"

## Auth intent preservation (PR #101, 2026-08-04)

One path could not be verified automatically: the QA account is magic-link only
(`scripts/qa-user.mjs` never sets a password), so `router.push(next)` after a
**password** sign-in is the single untested line. Everything either side of it —
the parsed target, the rendered links, the OAuth and confirmation-link paths, and
`/auth/callback` — was verified.

1. Signed out, open `/tournaments/<any-slug>/predict`
   - [ ] Lands on `/signup?next=…` showing "Create account", not "Welcome back"
   - [ ] The "Sign in" link carries the same `next`
2. From that `/login?next=…`, sign in **with email and password**
   - [ ] Lands on the bracket, not `/dashboard`
3. Same again with **Continue with Google**
   - [ ] Lands on the bracket
4. Brand-new account (email signup → confirmation link → username screen)
   - [ ] After setting a username, lands on the page that prompted the signup

## QA — Prediction Mode Toggle

## QA Checklist

1. Go to `/admin` → Settings tab
   - [ ] One option is always pre-selected on load (never blank)
   - [ ] Switching selection + hitting Save persists after full refresh
   - [ ] Description says "Does not affect challenges"
   - [ ] Impact note says "tournament predictions and auto-predict only"

2. Set toggle to **pre-tournament only** in admin, then:
   - [ ] `/challenges/create` — in-progress tournaments still appear
   - [ ] `/c/[code]` (anonymous challenge) for in-progress tournament — opponent can still submit picks
   - [ ] `/challenges/new` — in-progress tournaments still show as options
   - [ ] Challenge "Make your picks →" button on challenge detail page → goes to bracket (not redirected away)

3. With toggle set to **pre-tournament only**:
   - [ ] Visit an in-progress tournament's predict page (standalone, no challenge param) — redirected away (predictions blocked)
   - [ ] Tournament page shows "This tournament is already underway. Predictions are closed." for in_progress
