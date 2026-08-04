# QA — pending checks

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
