/**
 * Multiplier-gate checker — "does locking now decide the streak, and only that?"
 *
 * Gating the streak multiplier on locking is a change to the one thing in this
 * app nobody can be asked to forgive getting wrong: everybody's points. The
 * safety property is narrow and checkable — **a bracket that was locked must
 * score exactly what it scored before** — and the whole risk is that some lock
 * state nobody thought about fails to count as a commitment.
 *
 * So this replays `calculateStreakMultiplier` over every real prediction on
 * every completed tournament, twice: once as production computes it today, once
 * with the new `committed` gate, using each bracket's real `pick_locks`. Then it
 * reports every row where the two disagree, split by whether the bracket was
 * locked.
 *
 * Expected: locked brackets — zero differences. Unlocked drafts — multipliers
 * collapse to 1, which is the intended behaviour and the reason to lock.
 *
 * It also compares the old path against the `point_ledger.streak_multiplier`
 * actually stored, as a sanity check that this harness reproduces production at
 * all. That one is NOT expected to be a perfect match: brackets stay editable
 * mid-tournament, so a pick can differ from the one that earned the row.
 *
 * Read-only. Safe to run anytime.
 *
 *   node scripts/verify-multiplier-gate.mjs
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

const out = mkdtempSync(join(tmpdir(), 'mult-gate-'))
execFileSync('npx', [
  'tsc', 'src/lib/tennis/points.ts', 'src/lib/tennis/bracket.ts', 'src/lib/tennis/types.ts',
  '--outDir', out, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck',
], { cwd: root, stdio: 'inherit' })

const req = createRequire(import.meta.url)
const { calculateStreakMultiplier, committedPicks } = req(join(out, 'points.js'))
const { buildFeedMap } = req(join(out, 'bracket.js'))

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: tournaments, error: tErr } = await db
  .from('tournaments').select('id, name').eq('status', 'completed')
if (tErr) throw tErr

let lockedChanged = 0, lockedSame = 0, draftChanged = 0, draftSame = 0
let ledgerAgree = 0, ledgerDiffer = 0, scored = 0
const examples = []

for (const t of tournaments) {
  const [{ data: draw }, { data: results }, { data: preds }] = await Promise.all([
    db.from('draws').select('bracket_data').eq('tournament_id', t.id).maybeSingle(),
    db.from('match_results').select('external_match_id, winner_external_id, score')
      .eq('tournament_id', t.id),
    db.from('predictions').select('id, picks, pick_locks, locked_picks, is_fully_locked')
      .eq('tournament_id', t.id),
  ])
  const matches = draw?.bracket_data?.matches ?? []
  if (!matches.length || !results?.length || !preds?.length) continue

  const feedMap = buildFeedMap(matches)

  // Stored multipliers, keyed prediction:match, to sanity-check the replay.
  const { data: ledger } = await db
    .from('point_ledger')
    .select('prediction_id, streak_multiplier, match_results(external_match_id)')
    .eq('tournament_id', t.id)
  const stored = new Map()
  for (const row of ledger ?? []) {
    const m = row.match_results
    const ext = Array.isArray(m) ? m[0]?.external_match_id : m?.external_match_id
    if (ext) stored.set(`${row.prediction_id}:${ext}`, row.streak_multiplier ?? 1)
  }

  for (const p of preds) {
    const picks = p.picks ?? {}
    const late = new Set(p.locked_picks ?? [])
    const committed = committedPicks(p.pick_locks)

    for (const r of results) {
      if (r.score === 'BYE') continue
      if (picks[r.external_match_id] !== r.winner_external_id) continue  // only correct picks score
      scored++

      const before = calculateStreakMultiplier(
        r.external_match_id, r.winner_external_id, picks, feedMap, matches, late)
      const after = calculateStreakMultiplier(
        r.external_match_id, r.winner_external_id, picks, feedMap, matches, late, committed)

      const key = `${p.id}:${r.external_match_id}`
      if (stored.has(key)) (stored.get(key) === before ? ledgerAgree++ : ledgerDiffer++)

      if (before === after) { p.is_fully_locked ? lockedSame++ : draftSame++ }
      else {
        p.is_fully_locked ? lockedChanged++ : draftChanged++
        if (examples.length < 8) {
          examples.push(`${t.name} pred=${p.id.slice(0, 8)} ${r.external_match_id}: ` +
            `x${before} -> x${after}  locked=${p.is_fully_locked} ` +
            `lockType=${(p.pick_locks ?? {})[r.external_match_id] ?? 'none'}`)
        }
      }
    }
  }
}

console.log(`\nreplayed ${scored} scoring correct picks across ${tournaments.length} completed tournaments`)
console.log(`\nreplay vs stored point_ledger (sanity, not expected to be perfect —`)
console.log(`  brackets stay editable, so a pick can differ from the one that earned the row):`)
console.log(`  agree ${ledgerAgree}  differ ${ledgerDiffer}`)
console.log(`\nEFFECT OF THE GATE`)
console.log(`  locked brackets:   ${lockedSame} unchanged, ${lockedChanged} CHANGED`)
console.log(`  unlocked drafts:   ${draftSame} unchanged, ${draftChanged} changed (expected — this is the point)`)
if (examples.length) { console.log('\nexamples:'); for (const e of examples) console.log('  ' + e) }

if (lockedChanged > 0) {
  console.log(`\nFAIL: ${lockedChanged} already-locked pick(s) would score differently. ` +
    `Some lock state is not being counted as a commitment.`)
  process.exit(1)
}
console.log('\nPASS: no locked bracket changes value.')
