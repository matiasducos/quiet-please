# QA Checklist — Rolling Locks, Streak Multiplier & Challenge Predictions

## Locks

- [x] **Save draft picks** — Create a new prediction, make some picks, hit "Save draft". Verify picks persist on page reload.
- [x] **Lock individual pick** — Make a pick, click the lock icon on a single match. Verify it shows "LOCKED ✓", can't be changed, and survives page reload.
- [x] **Lock all picks** — Click "Lock all picks", confirm dialog. Verify all picks show locked, nothing editable, `is_fully_locked = true` in DB. *(Bug found & fixed: pick_locks was empty on INSERT path)*
- [x] **Auto-lock on match result** — Enter a match result (via admin/cron), reload predict page. Verify that match shows "PLAYED" badge and pick can't be changed.

## In-Progress Editing

- [x] **Edit unplayed matches during in_progress** — Set tournament to `in_progress`. Verify you can still pick/change unplayed matches but played ones are frozen.
- [x] **Downstream clearing respects locks** — Pick Player X through multiple rounds. Lock an early-round pick. Change a later pick — verify locked picks are NOT cleared.

## Scoring

- [ ] **Award points per-match scoring** — Run award-points cron after entering results. Verify points awarded only when `picks[matchId] === winner` (not if winner appears in any slot). *(TODO: verify with DB query tomorrow)*
- [ ] **Streak multiplier** — Pick a player to win R32→R16→QF. Enter results for all 3. Verify `point_ledger` shows `streak_multiplier` = 1, 2, 3 and `points` = base × multiplier.
- [ ] **Streak multiplier display** — View picks page after points awarded. Verify correct picks show "✓ +X pts ×N" badges when streak > 1.

## Challenges

- [ ] **Create challenge prediction** — Create a challenge, go to predict page with `?challenge=ID`. Verify a separate prediction row is created with `challenge_id` set.
- [ ] **Import global picks into challenge** — Start a challenge prediction with no picks. Click "Import from global picks". Verify global picks populate the bracket.
- [ ] **Challenge pick visibility (poker rule)** — As opponent, check if you can see the other player's challenge picks. Should only be visible for played matches OR when both are fully locked.

## Slot Enforcement & Cleanup

- [ ] **Weekly slot enforcement** — Try entering two ATP tournaments in the same ISO week. Verify the second one shows "Slot taken" error. Confirm challenges are exempt from this.
- [x] **Practice mode fully removed** — Verify no "Practice" buttons on completed tournaments, no practice banner, no `is_practice` references in UI anywhere.

## Pages & Filters

- [ ] **View other user's picks** — Go to `/tournaments/{id}/picks/{username}`. Verify it shows read-only bracket with correct/wrong styling and streak multiplier badges.
- [ ] **Leaderboard/profile/league filters** — Check leaderboard, profile, and league pages. Verify they filter on `is_fully_locked` / `challenge_id IS NULL` correctly (no practice rows).

## Notifications & Security

- [ ] **Friend notification on lock** — Lock all picks on a global prediction. Verify friends receive `friend_picks_locked` notification.
- [ ] **RLS policies** — As a regular user, verify you can read your own predictions + opponent's challenge predictions, but NOT other users' global predictions. Verify you can't update a fully locked prediction.
