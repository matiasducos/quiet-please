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
- [ ] **Import global picks into challenge** — Start a NEW challenge prediction. Click "Import from global picks". Verify global picks populate the bracket.
- [x] **Challenge pick visibility (poker rule)** — ✅ Both locked → can see opponent's picks. Works from both sides.

## Slot Enforcement & Cleanup

- [ ] **Weekly slot enforcement** — Try entering two ATP tournaments in the same ISO week. Verify "Slot taken" error. Confirm challenges are exempt.
- [x] **Practice mode fully removed** — ✅

## Pages & Filters

- [ ] **View other user's picks** — Go to `/tournaments/{id}/picks/{username}`. Verify read-only bracket with correct/wrong styling and streak multiplier badges.
- [ ] **Leaderboard/profile/league filters** — Check leaderboard, profile, and league pages. Verify they filter on `is_fully_locked` / `challenge_id IS NULL` correctly.

## Notifications & Security

- [ ] **Friend notification on lock** — Lock all picks on a global prediction. Verify friends receive `friend_picks_locked` notification.
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
