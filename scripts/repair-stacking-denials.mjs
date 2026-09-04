/**
 * Restores the streak multipliers denied at the US Open 2026 by two defects.
 *
 * Both denied a multiplier on a pick that WAS committed before its feeder was
 * decided — the thing the stacking rule is supposed to pay for. Neither is the
 * rule working: the rule itself (a pick committed after its feeder resolved
 * scores base x1) is left exactly as it stands, and nothing it denied is
 * touched here.
 *
 *   A. THE RETRO-STAMP. pick_lock_times (099) records when a pick was
 *      committed. savePrediction stamped a time on every match in a save's lock
 *      update rather than only the ones it committed, so a second "Lock all
 *      picks" re-dated every pre-099 commitment — a lock type with no time — to
 *      that moment, long after its feeder was decided.
 *
 *      Repaired at the CAUSE: the invented times are deleted, the picks go back
 *      to carrying a type and no time, and calculateStreakMultiplier reads that
 *      as "judge by the pre-099 rule" and pays the multiplier on its own. The
 *      ledger rows below are then just that answer, written down. A future
 *      re-score reproduces them.
 *
 *      Fixed forward in mergeLockState(); see scripts/verify-lock-merge.mjs.
 *
 *   B. THE ADMIN BULK-LOCK. The boundary is the EARLIER of played_at and
 *      draws.locked_matches, and locked_matches is meant to be the organiser
 *      freezing a match as it starts. At this tournament whole rounds were
 *      frozen in one batch, 13-22h (median) before their results were entered,
 *      so the boundary fired while the feeder was genuinely undecided.
 *
 *      NOT repaired at the cause, deliberately. Dropping locked_matches from
 *      the boundary would reopen what it was added to close: results are typed
 *      in by hand, so without it anyone can watch a match end and lock their
 *      next round before the operator reaches the keyboard (988 matches were
 *      locked before their result was entered, median gap 17.9h). The defect is
 *      the bulk locking, which is an operating practice, not this rule.
 *
 *      So these four rows are a ONE-OFF correction: values the scorer will not
 *      reproduce. If they are ever deleted and re-awarded they revert. They are
 *      listed explicitly below rather than derived, so that is visible.
 *
 * Never lowers a row. If any recomputation would reduce a stored multiplier the
 * script aborts without writing: repricing history downward is what a replay
 * does by accident, and 22 rows across five completed tournaments are already
 * in that state (see the session notes). This repair must not become that.
 *
 *   node scripts/repair-stacking-denials.mjs           # dry run
 *   node scripts/repair-stacking-denials.mjs --apply
 */

import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'child_process'
import { readFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, join } from 'path'
import { createRequire } from 'module'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')

const TOURNAMENT = '9bac1e41-b76e-47f2-ac27-994d5ffbd95b'  // US Open 2026

/**
 * The bulk-lock denials, by (prediction, match). Enumerated, not derived: these
 * are the rows a correction is being made for by hand, and the list is the
 * record of which ones.
 */
const BULK_LOCK_ROWS = [
  ['093ab804-5610-4a8a-8a13-6b1bf7e30d02', 'us-open-R64-020'],
  ['093ab804-5610-4a8a-8a13-6b1bf7e30d02', 'us-open-R64-025'],
  ['093ab804-5610-4a8a-8a13-6b1bf7e30d02', 'us-open-R64-032'],
  ['19954682-ce3b-4589-94eb-baa031f0caed', 'us-open-R64-007'],
]

const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env.local'), 'utf-8').split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const [k, ...r] = l.split('='); return [k.trim(), r.join('=').trim()] }))

const out = mkdtempSync(join(tmpdir(), 'repair-stacking-'))
execFileSync('npx', [
  'tsc', 'src/lib/tennis/points.ts', 'src/lib/tennis/bracket.ts', 'src/lib/tennis/types.ts',
  '--outDir', out, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck',
], { cwd: root, stdio: 'inherit' })
const req = createRequire(import.meta.url)
const { calculateStreakMultiplier, committedPicks } = req(join(out, 'points.js'))
const { buildFeedMap } = req(join(out, 'bracket.js'))

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

/** Paged read — PostgREST caps a response at 1000 rows and says nothing. */
async function all(table, select, filters = {}) {
  let rows = [], from = 0, done = false
  while (!done) {
    let q = db.from(table).select(select).range(from, from + 999)
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    rows = rows.concat(data ?? [])
    done = (data?.length ?? 0) < 1000
    from += 1000
  }
  return rows
}

const [draw, results, preds, ledger, users] = await Promise.all([
  db.from('draws').select('bracket_data, locked_matches').eq('tournament_id', TOURNAMENT).single()
    .then(({ data, error }) => { if (error) throw error; return data }),
  all('match_results', 'id, external_match_id, winner_external_id, played_at', { tournament_id: TOURNAMENT }),
  all('predictions', 'id, user_id, challenge_id, picks, pick_locks, pick_lock_times, locked_picks', { tournament_id: TOURNAMENT }),
  all('point_ledger', 'id, user_id, prediction_id, match_result_id, points, streak_multiplier', { tournament_id: TOURNAMENT }),
  all('users', 'id, username'),
])

const matches = draw.bracket_data?.matches ?? []
const feedMap = buildFeedMap(matches)
const roundOf = Object.fromEntries(matches.map(m => [m.matchId, m.round]))
const adminLocked = draw.locked_matches ?? {}
const playedAt = {}
for (const r of results) if (r.played_at) playedAt[r.external_match_id] = r.played_at
const resultById = Object.fromEntries(results.map(r => [r.id, r]))
const predById = Object.fromEntries(preds.map(p => [p.id, p]))
const nameOf = Object.fromEntries(users.map(u => [u.id, u.username]))

// ── A. Which lock times were invented ────────────────────────────────────────
//
// A save writes ONE lock type, and a round lock covers ONE round. So inside a
// single lock-time group, the type the save actually wrote is the lock-all type
// when one is present; every key carrying a DIFFERENT type was already
// committed before that save and only had its time re-dated. That is the
// retro-stamped set, exactly — not a heuristic about how many keys share a
// timestamp, which would also catch a legitimate round lock.
function retroStamped(p) {
  const groups = {}
  for (const [matchId, at] of Object.entries(p.pick_lock_times ?? {})) (groups[at] ??= []).push(matchId)
  const retro = new Set()
  for (const matchIds of Object.values(groups)) {
    const types = new Set(matchIds.map(m => p.pick_locks?.[m]).filter(t => t && t !== 'auto'))
    const spansRounds = new Set(matchIds.map(m => roundOf[m])).size > 1
    if (types.size <= 1 && !(types.has('round') && spansRounds)) continue
    const saveType = types.has('auto_lock_all') ? 'auto_lock_all' : null
    for (const m of matchIds) if (p.pick_locks?.[m] !== saveType) retro.add(m)
  }
  return retro
}

const timeFixes = []
const repairedTimes = {}
for (const p of preds) {
  const retro = retroStamped(p)
  const times = { ...(p.pick_lock_times ?? {}) }
  for (const m of retro) delete times[m]
  repairedTimes[p.id] = times
  if (retro.size) {
    // The removed values are printed so the change is reversible by hand: they
    // are the only record of what was there, and deleting them is the point.
    const stamps = [...new Set([...retro].map(m => p.pick_lock_times[m]))].sort()
    timeFixes.push({ prediction: p.id, user: nameOf[p.user_id], removed: retro.size, times, stamps })
  }
}

console.log('\n── A. invented lock times to remove ──')
if (!timeFixes.length) console.log('  none')
for (const f of timeFixes) {
  console.log(`  ${f.prediction}  ${f.user}  ${f.removed} commitment times deleted (they predate 099)`)
  console.log(`    values removed (restore these to undo): ${f.stamps.join(', ')}`)
}

// ── Recompute every ledger row ───────────────────────────────────────────────
const bulkLockSet = new Set(BULK_LOCK_ROWS.map(([p, m]) => `${p}:${m}`))
const changes = []
let lowered = 0

for (const l of ledger) {
  const p = predById[l.prediction_id], r = resultById[l.match_result_id]
  if (!p || !r) continue
  const key = `${p.id}:${r.external_match_id}`
  const isBulkLock = bulkLockSet.has(key)

  const multiplier = calculateStreakMultiplier(
    r.external_match_id, r.winner_external_id, p.picks, feedMap, matches,
    new Set(p.locked_picks ?? []),
    committedPicks(p.pick_locks),
    repairedTimes[p.id],
    playedAt,
    // The one-off: this row alone is judged without the bulk lock as a boundary.
    isBulkLock ? undefined : adminLocked,
  )
  if (multiplier === l.streak_multiplier) continue

  const base = l.points / l.streak_multiplier
  if (multiplier < l.streak_multiplier) lowered++
  changes.push({
    id: l.id, user: nameOf[p.user_id] ?? p.user_id.slice(0, 8),
    scope: p.challenge_id ? 'challenge' : 'global',
    match: r.external_match_id, from: l.streak_multiplier, to: multiplier,
    points: base * multiplier, was: l.points, gain: base * multiplier - l.points,
    cause: isBulkLock ? 'B bulk-lock (one-off)' : 'A retro-stamp (healed)',
    userId: p.user_id, predictionId: p.id,
  })
}

console.log('\n── ledger rows to rewrite ──')
console.table(changes.map(({ id, userId, predictionId, ...rest }) => rest))
console.log(`  ${changes.length} rows, ${changes.reduce((a, c) => a + c.gain, 0)} points restored`)

if (lowered > 0) {
  console.error(`\nABORT: ${lowered} row(s) would be LOWERED. This repair only restores.`)
  process.exit(1)
}
const missing = BULK_LOCK_ROWS.filter(([p, m]) => !changes.some(c => c.predictionId === p && c.match === m))
if (missing.length) {
  console.error(`\nABORT: ${missing.length} listed bulk-lock row(s) did not come out changed — the data moved under this script.`)
  for (const [p, m] of missing) console.error(`  ${p} ${m}`)
  process.exit(1)
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.')
  process.exit(0)
}

// ── Write ────────────────────────────────────────────────────────────────────
for (const f of timeFixes) {
  const { error } = await db.from('predictions').update({ pick_lock_times: f.times }).eq('id', f.prediction)
  if (error) throw new Error(`pick_lock_times ${f.prediction}: ${error.message}`)
}
console.log(`\nwrote pick_lock_times on ${timeFixes.length} prediction(s)`)

for (const c of changes) {
  const { error } = await db.from('point_ledger')
    .update({ points: c.points, streak_multiplier: c.to }).eq('id', c.id)
  if (error) throw new Error(`point_ledger ${c.id}: ${error.message}`)
}
console.log(`wrote ${changes.length} ledger row(s)`)

// ── Derived state, in award-points' own order (steps 8, 9a, 9b) ──────────────
// points_earned is recomputed as the ledger SUM rather than nudged by a delta,
// for the same reason the cron does it that way: it is idempotent, so running
// this script twice cannot inflate anyone.
const predIds = [...new Set(changes.map(c => c.predictionId))]
for (const predId of predIds) {
  const rows = await all('point_ledger', 'points', { prediction_id: predId })
  const total = rows.reduce((a, r) => a + r.points, 0)
  const { error } = await db.from('predictions').update({ points_earned: total }).eq('id', predId)
  if (error) throw new Error(`points_earned ${predId}: ${error.message}`)
}
console.log(`recomputed points_earned on ${predIds.length} prediction(s)`)

// Only global brackets move rankings and leagues; a challenge bracket affects
// neither, so its users must not be swept into either recalculation.
const userIds = [...new Set(changes.filter(c => c.scope === 'global').map(c => c.userId))]
if (userIds.length) {
  const { data: memberships, error: memErr } = await db
    .from('league_members').select('league_id, user_id').in('user_id', userIds)
  if (memErr) throw new Error(`league_members: ${memErr.message}`)
  for (const m of memberships ?? []) {
    const { error } = await db.rpc('recalculate_member_points', { p_league_id: m.league_id, p_user_id: m.user_id })
    if (error) throw new Error(`recalculate_member_points ${m.league_id}: ${error.message}`)
  }
  console.log(`recalculated ${memberships?.length ?? 0} (user, league) pair(s)`)

  const { error: rankErr } = await db.rpc('recalculate_ranking_points_bulk', { p_user_ids: userIds })
  if (rankErr) throw new Error(`recalculate_ranking_points_bulk: ${rankErr.message}`)
  console.log(`recalculated rankings for ${userIds.length} user(s)`)
}

console.log('\nAPPLIED.')
