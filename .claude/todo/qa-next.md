# QA — Next Session (2026-03-28)

## Bug: "Challenge →" button does nothing on /challenges/new

**Symptoms:** Clicking the button on step 2 (pick a tournament) produces no visible response — no loading state, no redirect, no error.

**Diagnosis:**
1. `ChallengeButton` ignores the server action's return value — errors are silently swallowed. If `createChallenge` returns `{ error: "..." }`, the button just resets to idle with no message shown.
2. Possible root cause A: a DB-level error on insert (e.g. unique constraint violation if a pending/accepted challenge already exists between the same two users for that tournament).
3. Possible root cause B: the `TournamentCard` renders as a `<Link>` covering the card, and the absolutely-positioned "Challenge →" button may be captured by the link's pointer area before reaching the form submit handler.

**Fix needed (two things):**
- `ChallengeButton.tsx`: handle the return value and display the error to the user (add `const result = await createChallenge(formData); if (!result?.ok...) setError(result.error)` pattern).
- `challenges/new/page.tsx`: pass `disableLink` to `<TournamentCard>` since the card is display-only here — the challenge button is the action.

**Files:**
- `src/app/challenges/new/ChallengeButton.tsx`
- `src/app/challenges/new/page.tsx`
- `src/app/challenges/new/actions.ts`

---

## QA Checklist — Prediction Mode Toggle

1. Go to `/admin` → Settings tab
   - [ ] One option is always pre-selected on load (never blank)
   - [ ] Switching selection + hitting Save persists after full refresh
   - [ ] Description says "Does not affect challenges"
   - [ ] Impact note says "tournament predictions and auto-predict only"

2. Set toggle to **pre-tournament only** in admin, then:
   - [ ] `/challenges/create` — in-progress tournaments still appear
   - [ ] `/c/[code]` (anonymous challenge) for in-progress tournament — opponent can still submit picks
   - [ ] `/challenges/new` — in-progress tournaments still show as options

3. With toggle set to **pre-tournament only**:
   - [ ] Visit an in-progress tournament's predict page — bracket is read-only (predictions blocked)
