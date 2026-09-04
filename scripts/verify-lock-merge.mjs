/**
 * Lock-merge checker — "can a later save rewrite what an earlier one committed?"
 *
 * `pick_locks` says HOW a pick was committed, `pick_lock_times` (099) says WHEN,
 * and the multiplier's stacking rule reads the WHEN. Both are therefore worth
 * points, and `savePrediction` merges rather than overwrites. This replays that
 * merge — the pure `mergeLockState` the action now calls — against the two
 * things that can go wrong.
 *
 * Why this exists next to verify-stacking-rule.mjs: that script replays SCORING
 * over a fixed snapshot of pick_lock_times and is blind to anything that writes
 * the column. The live bug it missed was a write — one "Lock all picks" on an
 * in-progress US Open bracket re-dated 69 picks that had been committed days
 * earlier (pre-099, so a lock type with no time), stamping them long after
 * their feeders were decided and stripping a multiplier already earned.
 *
 * Six properties. E is the regression; the rest are what E must not break.
 *
 *   A. A new lock gets a type and a time.
 *   B. First lock wins — an existing type is never rewritten ('auto' must never
 *      be upgraded to 'auto_lock_all' by a later lock-all).
 *   C. First write wins on times — an existing time is never rewritten.
 *   D. Lockstep — the merge never writes a time without a lock.
 *   E. A committed pick with NO time must stay untimed. "No time" means
 *      "committed before we recorded times", which calculateStreakMultiplier
 *      reads as the pre-099 rule; filling it in is not a repair, it is a
 *      forward-dated commitment.
 *   F. The same, replayed over every real prediction in the database: a
 *      lock-all over the whole bracket must change no existing lock and no
 *      existing (or missing) time.
 *
 * Read-only. Safe to run anytime.
 *
 *   node scripts/verify-lock-merge.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'child_process'
import { readFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, join } from 'path'
import { createRequire } from 'module'

const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env.local'), 'utf-8')
    .split('\n').filter(l => l && !l.startsWith('#'))
    .map(l => { const [k, ...r] = l.split('='); return [k.trim(), r.join('=').trim()] }),
)

const out = mkdtempSync(join(tmpdir(), 'lock-merge-'))
execFileSync('npx', [
  'tsc', 'src/lib/tennis/lock-merge.ts',
  '--outDir', out, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck',
], { cwd: root, stdio: 'inherit' })

const { mergeLockState } = createRequire(import.meta.url)(join(out, 'lock-merge.js'))

const NOW = '2026-09-04T12:00:00.000Z'
let failures = 0
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

// ── A–E: the merge on its own ────────────────────────────────────────────────
console.log('\nmergeLockState')

{
  const r = mergeLockState({}, {}, { m1: 'voluntary' }, NOW)
  check('A  a new lock gets a type and a time',
    r.pickLocks.m1 === 'voluntary' && r.pickLockTimes.m1 === NOW && r.newlyLocked.join() === 'm1',
    JSON.stringify(r))
}

{
  // The cron stamped 'auto' after the match played; a later "lock all" must not
  // turn that into a commitment.
  const r = mergeLockState({ m1: 'auto' }, { }, { m1: 'auto_lock_all', m2: 'auto_lock_all' }, NOW)
  check('B  first lock wins — \'auto\' is not upgraded',
    r.pickLocks.m1 === 'auto' && r.pickLocks.m2 === 'auto_lock_all', JSON.stringify(r.pickLocks))
  check('B2 an untouched existing lock is not re-timed',
    r.pickLockTimes.m1 === undefined && r.pickLockTimes.m2 === NOW, JSON.stringify(r.pickLockTimes))
}

{
  const earlier = '2026-08-29T08:00:00.000Z'
  const r = mergeLockState({ m1: 'round' }, { m1: earlier }, { m1: 'auto_lock_all' }, NOW)
  check('C  first write wins on times', r.pickLockTimes.m1 === earlier, r.pickLockTimes.m1)
}

{
  const r = mergeLockState({ m1: 'voluntary', m2: 'round' }, { m1: NOW }, { m3: 'voluntary' }, NOW)
  const timesWithoutLocks = Object.keys(r.pickLockTimes).filter(m => !r.pickLocks[m])
  check('D  no time is written without a lock', timesWithoutLocks.length === 0, timesWithoutLocks.join())
}

{
  // The live regression: a pre-099 bracket, every pick committed, no times at
  // all — then the user presses "Lock all picks" again.
  const existingLocks = Object.fromEntries(
    Array.from({ length: 69 }, (_, i) => [`m${i}`, i < 64 ? 'round' : 'voluntary']))
  const update = { ...Object.fromEntries(Object.keys(existingLocks).map(m => [m, 'auto_lock_all'])), fresh: 'auto_lock_all' }
  const r = mergeLockState(existingLocks, {}, update, NOW)
  const stamped = Object.keys(existingLocks).filter(m => r.pickLockTimes[m] !== undefined)
  check('E  a committed pick with no time stays untimed',
    stamped.length === 0, `${stamped.length} of 69 re-dated to ${NOW}`)
  check('E2 …while a genuinely new lock still gets one', r.pickLockTimes.fresh === NOW)
  const rewritten = Object.entries(existingLocks).filter(([m, t]) => r.pickLocks[m] !== t)
  check('E3 …and their lock types are untouched', rewritten.length === 0, `${rewritten.length} rewritten`)
}

// ── F: the same, over every real bracket ─────────────────────────────────────
console.log('\nreplayed over real predictions (lock-all over the whole bracket)')

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

let from = 0, page = 1000, rows = [], done = false
while (!done) {
  const { data, error } = await db
    .from('predictions')
    .select('id, picks, pick_locks, pick_lock_times')
    .range(from, from + page - 1)
  if (error) throw error
  rows = rows.concat(data ?? [])
  done = (data?.length ?? 0) < page
  from += page
}

let typesChanged = 0, timesChanged = 0, timesAdded = 0, newLocks = 0
for (const p of rows) {
  const locks = p.pick_locks ?? {}
  const times = p.pick_lock_times ?? {}
  // What "Lock all picks" sends: every pick in the bracket.
  const update = Object.fromEntries(Object.keys(p.picks ?? {}).map(m => [m, 'auto_lock_all']))
  const r = mergeLockState(locks, times, update, NOW)

  for (const [m, t] of Object.entries(locks)) if (r.pickLocks[m] !== t) typesChanged++
  for (const [m, t] of Object.entries(times)) if (r.pickLockTimes[m] !== t) timesChanged++
  for (const m of Object.keys(locks)) if (times[m] === undefined && r.pickLockTimes[m] !== undefined) timesAdded++
  newLocks += r.newlyLocked.length
}

console.log(`  ${rows.length} brackets replayed; ${newLocks} picks would be newly committed`)
check('F  no existing lock type changes', typesChanged === 0, `${typesChanged} changed`)
check('F2 no existing lock time changes', timesChanged === 0, `${timesChanged} changed`)
check('F3 no untimed commitment acquires a time', timesAdded === 0, `${timesAdded} re-dated`)

console.log(failures === 0 ? '\nAll properties hold.\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
