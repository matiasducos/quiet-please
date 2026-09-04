/**
 * Merging a save's lock state into the lock state a bracket already carries.
 *
 * Two parallel maps on `predictions`: `pick_locks` records HOW each pick was
 * committed ('voluntary' | 'round' | 'auto_lock_all', plus the cron's 'auto'),
 * and `pick_lock_times` (migration 099) records WHEN. The multiplier's stacking
 * rule reads the time, so both are worth points and neither may be rewritten by
 * a later save.
 *
 * Pure on purpose: `savePrediction` is a server action wrapped in auth and
 * Supabase calls, and this is the part that has to be replayable on its own.
 * See `scripts/verify-lock-merge.mjs`.
 */

export type LockMap = Record<string, string>

export type MergedLockState = {
  pickLocks: LockMap
  pickLockTimes: LockMap
  /** The matches this save actually committed — nothing else changed. */
  newlyLocked: string[]
}

/**
 * First lock wins, and only a NEW lock gets a time.
 *
 * - An existing lock keeps its type: 'auto' is what the cron stamps on a played
 *   match, and letting a subsequent "lock all" turn that into 'auto_lock_all'
 *   would back-date a commitment nobody made.
 *
 * - An existing lock keeps its time, INCLUDING when it has none. This is the
 *   half that is easy to get wrong: every "Lock all picks" resubmits the whole
 *   bracket, so stamping each key in `update` would forward-date the picks
 *   committed before 099 existed — a lock type with no time — to today, long
 *   after their feeders were decided, and strip a stacking credit already
 *   earned. A missing time is not a gap to fill; it means "committed before we
 *   recorded times", which `calculateStreakMultiplier` reads as the pre-099
 *   rule. That fallback IS 099's forward-only guarantee.
 */
export function mergeLockState(
  existingLocks: LockMap | null | undefined,
  existingTimes: LockMap | null | undefined,
  update: LockMap | undefined,
  lockedNow: string,
): MergedLockState {
  const pickLocks: LockMap = { ...(existingLocks ?? {}) }
  const pickLockTimes: LockMap = { ...(existingTimes ?? {}) }
  const newlyLocked: string[] = []

  for (const [matchId, lockType] of Object.entries(update ?? {})) {
    if (pickLocks[matchId]) continue
    pickLocks[matchId] = lockType
    newlyLocked.push(matchId)
    if (!pickLockTimes[matchId]) pickLockTimes[matchId] = lockedNow
  }

  return { pickLocks, pickLockTimes, newlyLocked }
}
