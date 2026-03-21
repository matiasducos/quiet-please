# QA Checklist — Rolling Locks, Streak Multiplier & Challenge Predictions

## Locks ✅

- [x] **Save draft picks** — ✅
- [x] **Lock individual pick** — ✅
- [x] **Lock all picks** — ✅ *(Bug found & fixed: pick_locks was empty on INSERT path)*
- [x] **Auto-lock on match result** — ✅

## In-Progress Editing ✅

- [x] **Edit unplayed matches during in_progress** — ✅
- [x] **Downstream clearing respects locks** — ✅

## Scoring ⏳

- [ ] **Award points per-match scoring** — Enter R64 results, run Award Points from admin panel. Check DB:
  ```sql
  SELECT pl.points, mr.external_match_id, mr.winner_external_id, p.picks
  FROM point_ledger pl
  JOIN match_results mr ON mr.id = pl.match_result_id
  JOIN predictions p ON p.id = pl.prediction_id
  WHERE pl.tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230'
  LIMIT 10;
  ```
  Verify `picks->>external_match_id === winner_external_id` for each row.

- [ ] **Streak multiplier** — Pick a player through R32→R16→QF. Enter all 3 results. Run Award Points. Check `point_ledger` shows `streak_multiplier` = 1, 2, 3.

- [ ] **Streak multiplier display** — View picks page after points awarded. Verify "✓ +X pts ×N" badges when streak > 1.

## Challenges ⏳

- [x] **Create challenge prediction** — ✅ Verified: separate prediction row with `challenge_id` set in DB.
- [x] **Import global picks into challenge** — ✅ Code audit: banner shows for new challenge predictions, imports correctly, merges into state.
- [x] **Challenge pick visibility (poker rule)** — ✅ Both locked → can see opponent's picks. Works from both sides.

## Slot Enforcement & Cleanup

- [x] **Weekly slot enforcement** — ✅ Code audit: INSERT-only check, challenges/manual exempt, ISO week correct, UI shows error with tournament name.
- [x] **Practice mode fully removed** — ✅

## Pages & Filters

- [x] **View other user's picks** — ✅ Code audit + fix: readOnly bracket with results/streaks works. **Bug found & fixed**: page exposed unlocked picks to other users (admin client bypassed RLS). Added `is_fully_locked` check.
- [x] **Leaderboard/profile/league filters** — ✅ Code audit + fix: leaderboard/league correct. **Bug found & fixed**: profile page showed unlocked predictions to other users. Added `is_fully_locked` filter for non-own profiles.

## Notifications & Security

- [x] **Friend notification on lock** — ✅ Verified in prod. Also added new `challenge_picks_locked` notification for challenge opponent lock events.
- [ ] **RLS policies** — As a regular user, verify: can read own predictions + opponent's challenge predictions, but NOT other users' global predictions. Can't update a fully locked prediction.

---

## Bugs Found & Fixed During QA

1. **Lock-all pick_locks empty** — INSERT path didn't set `pick_locks` on the row. Fixed.
2. **Bracket result propagation** — Real match results weren't propagating into later rounds. Fixed with `getEffectivePlayer` priority: result → pick → TBD.
3. **Dead picks** — User picks for eliminated players now show "eliminated" badge.
4. **Challenge duplicate prevention** — No unique constraint. Added server-side check + client debounce.
5. **Import banner persisting** — Showed on every visit, not just first. Fixed with `!currentPredictionId` guard.
6. **Challenge visibility** — No "View opponent's picks" link. Added with poker rule (both must be locked).
7. **Cascade delete on result edit** — Editing a match result didn't clean up downstream results. Added cascade.
8. **Cancel challenge button silent fail** — Plain `<form action>` swallowed server action errors. Replaced with client CancelButton component using `useTransition`.
9. **Lock all picks RLS policy** — UPDATE policy lacked `WITH CHECK`, defaulting to `USING (is_fully_locked = false)`, which rejected the row after flipping to `true`. Added explicit `WITH CHECK (auth.uid() = user_id)`.
10. **Unlocked picks exposed** — `/picks/[username]` used admin client and didn't check `is_fully_locked`, leaking in-progress brackets. Added access control.
11. **Profile showed unlocked predictions** — Other users could see in-progress tournament entries. Added `is_fully_locked` filter for non-own profiles.
