/**
 * Reopen brackets that were locked out of rounds they could still be picking.
 *
 * Run: node scripts/unlock-stuck-brackets.mjs           (dry run — prints the plan)
 *      node scripts/unlock-stuck-brackets.mjs --apply   (writes)
 *
 * WHY THIS EXISTS
 *
 * Two ways a bracket ends up frozen with most of the draw unpicked:
 *
 *  1. The auto-predict cron. It sets is_fully_locked = true as its own
 *     idempotency marker ("created and locked → never re-run"), so a user with
 *     auto-predict on gets a permanently final bracket holding only their
 *     configured players' path — 15 to 27 picks out of 127 at a slam. They
 *     never clicked anything.
 *  2. "Lock all picks". New users read the primary button on the predict page
 *     as "submit", lock a first round, and lose the tournament before it
 *     starts.
 *
 * Migration 094 gives both groups a way out from inside the app. This script
 * is for the people already stuck when it shipped, who have no reason to come
 * back and look.
 *
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Exactly what unlock_prediction() does: clears the full lock, and keeps
 * pick_locks only on matches that have already been played. Commitments on
 * undecided matches are given back — the streak multiplier is earned by
 * committing before the result, so a bracket that is editable again cannot go
 * on claiming it. Re-locking restores it.
 *
 * It does NOT touch a bracket that was locked on purpose. The measure is how
 * much of the tournament the lock has shut the user out of: matches with no
 * pick that have not been played yet. On the data this was written against,
 * the split is not close — the accidents sit at 50-88% of the draw, and every
 * deliberate lock at 0-5%:
 *
 *   @jamie            15 picks · locked out of 112/127  (88%)  auto-predict
 *   @eugeniogenio     17 picks · locked out of 110/127  (87%)  auto-predict
 *   @floridafanatic   63 picks · locked out of  64/127  (50%)  new user, day one
 *   ---------------------------------------------------------- threshold
 *   @toro             14 picks · locked out of   3/63   ( 5%)
 *   @bennyto          47 picks · locked out of   0/63   ( 0%)  deliberate
 *
 * The bottom two matter as much as the top three. Unlocking @bennyto would
 * withdraw three multiplier commitments he chose to make and hand him back
 * nothing at all — there is nothing left for him to pick. A repair that has to
 * guess is a repair that can take something away, so it only acts where the
 * user is demonstrably locked out of the tournament.
 *
 * Global brackets only. A friends challenge reveals both brackets once both
 * sides lock, so reopening one from a script could put someone back in the
 * draw with their opponent's picks already visible.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

/** Share of the draw a bracket must be locked out of before this repairs it. */
const LOCKED_OUT_THRESHOLD = 0.25

const APPLY = process.argv.includes('--apply')

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }),
)

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const isBot = email => String(email ?? '').endsWith('@bot.quietplease.app')

// Only tournaments a user could still be picking. Anywhere else, unlocking
// changes nothing they can act on.
const { data: tournaments, error: tErr } = await db
  .from('tournaments')
  .select('id, name, status, flag_emoji')
  .in('status', ['accepting_predictions', 'in_progress'])
if (tErr) throw new Error(`tournaments: ${tErr.message}`)

const plan = []
const skipped = []

for (const t of tournaments ?? []) {
  const [{ data: draw, error: dErr }, { data: results, error: rErr }] = await Promise.all([
    db.from('draws').select('bracket_data').eq('tournament_id', t.id).single(),
    db.from('match_results').select('external_match_id').eq('tournament_id', t.id),
  ])
  if (dErr || rErr) { console.error(`  skip ${t.name}: ${dErr?.message ?? rErr?.message}`); continue }

  const matches = draw?.bracket_data?.matches ?? []
  if (!matches.length) continue

  const played = new Set((results ?? []).map(r => r.external_match_id))
  const roundMatches = new Map()
  for (const m of matches) {
    if (!roundMatches.has(m.round)) roundMatches.set(m.round, [])
    roundMatches.get(m.round).push(m.matchId)
  }

  const { data: preds, error: pErr } = await db
    .from('predictions')
    .select('id, user_id, picks, pick_locks, is_fully_locked, unlock_count, users(username, email)')
    .eq('tournament_id', t.id)
    .eq('is_fully_locked', true)
    .is('challenge_id', null)
  if (pErr) throw new Error(`predictions for ${t.name}: ${pErr.message}`)

  for (const p of preds ?? []) {
    const user = p.users
    if (isBot(user?.email)) continue

    const picked = new Set(Object.keys(p.picks ?? {}).filter(k => p.picks[k]))

    // What the lock is actually costing: matches still to be played that this
    // bracket has no pick for and, while locked, never can.
    const lockedOut = matches.filter(m => !picked.has(m.matchId) && !played.has(m.matchId)).length
    const share = lockedOut / matches.length

    const locks = p.pick_locks ?? {}
    const keptLocks = Object.fromEntries(Object.entries(locks).filter(([id]) => played.has(id)))
    const withdrawn = Object.keys(locks).length - Object.keys(keptLocks).length

    // Rounds with no pick at all — not the criterion, but the clearest way to
    // show a human what the bracket has given up.
    const emptyRounds = []
    for (const [round, ids] of roundMatches) {
      if (ids.some(id => picked.has(id))) continue
      if (ids.every(id => played.has(id))) continue
      emptyRounds.push(`${round}(${ids.length})`)
    }

    const row = {
      predictionId: p.id,
      username: user?.username ?? p.user_id.slice(0, 8),
      tournament: `${t.flag_emoji ?? ''} ${t.name}`.trim(),
      picks: picked.size,
      draw: matches.length,
      lockedOut,
      share,
      emptyRounds,
      keptLocks,
      withdrawn,
      unlockCount: p.unlock_count ?? 0,
    }

    if (share >= LOCKED_OUT_THRESHOLD) plan.push(row)
    else skipped.push(row)
  }
}

const pct = row => `${Math.round(row.share * 100)}%`

if (skipped.length > 0) {
  console.log(`Leaving ${skipped.length} locked bracket${skipped.length === 1 ? '' : 's'} alone (locked out of under ${LOCKED_OUT_THRESHOLD * 100}% of the draw — a deliberate lock):\n`)
  for (const row of skipped) {
    console.log(`  @${row.username} — ${row.tournament}: ${row.picks}/${row.draw} picks, locked out of ${row.lockedOut} (${pct(row)}), would have cost ${row.withdrawn} commitment${row.withdrawn === 1 ? '' : 's'}`)
  }
  console.log('')
}

if (plan.length === 0) {
  console.log('Nothing to repair — no locked bracket is shut out of a meaningful part of its draw.')
  process.exit(0)
}

console.log(`${APPLY ? 'UNLOCKING' : 'WOULD UNLOCK'} ${plan.length} bracket${plan.length === 1 ? '' : 's'}:\n`)
for (const row of plan) {
  console.log(`  @${row.username} — ${row.tournament}`)
  console.log(`    ${row.picks}/${row.draw} picks · locked out of ${row.lockedOut} unplayed matches (${pct(row)})`)
  if (row.emptyRounds.length) console.log(`    rounds with no pick at all: ${row.emptyRounds.join(' ')}`)
  console.log(`    commitments: keeping ${Object.keys(row.keptLocks).length} on played matches, withdrawing ${row.withdrawn}`)
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.')
  process.exit(0)
}

console.log('')
let ok = 0
for (const row of plan) {
  const { error } = await db
    .from('predictions')
    .update({
      is_fully_locked: false,
      fully_locked_at: null,
      pick_locks:      row.keptLocks,
      unlocked_at:     new Date().toISOString(),
      unlock_count:    row.unlockCount + 1,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', row.predictionId)

  if (error) console.error(`  FAILED @${row.username}: ${error.message}`)
  else { console.log(`  unlocked @${row.username} — ${row.tournament}`); ok++ }
}
console.log(`\n${ok}/${plan.length} unlocked.`)
