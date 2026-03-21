# QA Checklist — Rolling Locks, Streak Multiplier & Challenge Predictions

## Locks ✅

- [x] **Save draft picks** — ✅
- [x] **Lock individual pick** — ✅
- [x] **Lock all picks** — ✅ *(Bug found & fixed: pick_locks was empty on INSERT path)*
- [x] **Auto-lock on match result** — ✅

## In-Progress Editing ✅

- [x] **Edit unplayed matches during in_progress** — ✅
- [x] **Downstream clearing respects locks** — ✅

## Scoring ✅

- [x] **Award points per-match scoring** — ✅ Verified in prod: 52 results processed, 57 point entries created, 3 users awarded. **Two bugs found & fixed**: (1) `.neq('score','BYE')` excluded NULL scores (PostgreSQL NULL comparison trap), (2) `recalculate_ranking_points` ran before `predictions.points_earned` was updated (execution order bug).
- [x] **Streak multiplier** — ✅ Verified in prod: DB shows `streak_multiplier = 2` for R64 correct picks where R128 was also correct.
- [x] **Streak multiplier display** — ✅ Verified in prod: UI shows "✓ +50 pts ×2" badges on R64 streak matches.

## Challenges ✅

- [x] **Create challenge prediction** — ✅ Verified: separate prediction row with `challenge_id` set in DB.
- [x] **Import global picks into challenge** — ✅ Code audit: banner shows for new challenge predictions, imports correctly, merges into state.
- [x] **Challenge pick visibility (poker rule)** — ✅ Both locked → can see opponent's picks. Works from both sides.

## Slot Enforcement & Cleanup ✅

- [x] **Weekly slot enforcement** — ✅ Code audit: INSERT-only check, challenges/manual exempt, ISO week correct, UI shows error with tournament name.
- [x] **Practice mode fully removed** — ✅

## Pages & Filters ✅

- [x] **View other user's picks** — ✅ Code audit + fix: readOnly bracket with results/streaks works. **Bug found & fixed**: page exposed unlocked picks to other users (admin client bypassed RLS). Added `is_fully_locked` check.
- [x] **Leaderboard/profile/league filters** — ✅ Code audit + fix: leaderboard/league correct. **Bug found & fixed**: profile page showed unlocked predictions to other users. Added `is_fully_locked` filter for non-own profiles.

## Notifications & Security ✅

- [x] **Friend notification on lock** — ✅ Verified in prod. Also added new `challenge_picks_locked` notification for challenge opponent lock events.
- [x] **RLS policies** — ✅ Full code audit: 3 policies active (INSERT own, SELECT own+challenge opponent, UPDATE non-locked own). All 4 access control requirements verified. Admin client bypasses defended by app-layer checks.

---

## Bugs Found & Fixed During QA

1. ✅ **Lock-all pick_locks empty** — INSERT path didn't set `pick_locks` on the row. Fixed.
2. ✅ **Bracket result propagation** — Real match results weren't propagating into later rounds. Fixed with `getEffectivePlayer` priority: result → pick → TBD.
3. ✅ **Dead picks** — User picks for eliminated players now show "eliminated" badge.
4. ✅ **Challenge duplicate prevention** — No unique constraint. Added server-side check + client debounce.
5. ✅ **Import banner persisting** — Showed on every visit, not just first. Fixed with `!currentPredictionId` guard.
6. ✅ **Challenge visibility** — No "View opponent's picks" link. Added with poker rule (both must be locked).
7. ✅ **Cascade delete on result edit** — Editing a match result didn't clean up downstream results. Added cascade.
8. ✅ **Cancel challenge button silent fail** — Plain `<form action>` swallowed server action errors. Replaced with client CancelButton component using `useTransition`.
9. ✅ **Lock all picks RLS policy** — UPDATE policy lacked `WITH CHECK`, defaulting to `USING (is_fully_locked = false)`, which rejected the row after flipping to `true`. Added explicit `WITH CHECK (auth.uid() = user_id)`.
10. ✅ **Unlocked picks exposed** — `/picks/[username]` used admin client and didn't check `is_fully_locked`, leaking in-progress brackets. Added access control.
11. ✅ **Profile showed unlocked predictions** — Other users could see in-progress tournament entries. Added `is_fully_locked` filter for non-own profiles.
12. ✅ **Award points NULL score exclusion** — `.neq('score', 'BYE')` excluded all results with NULL score (PostgreSQL NULL != value = NULL). Fixed with `.or('score.neq.BYE,score.is.null')`.
13. ✅ **Ranking recalculation order** — `recalculate_ranking_points` read `predictions.points_earned` before it was updated, leaving leaderboard empty. Reordered steps so prediction update runs first. Also removed ghost `increment_user_points` RPC call (never defined).
14. ✅ **Ranking recalculation early return** — When no new points to award, cron returned early before running `recalculate_ranking_points`. Removed early return so rankings always get recalculated.
15. ✅ **Points per round card incomplete** — Tournament page only showed R16–Winner. Added R32, R64, R128 (conditional on tournament category).
