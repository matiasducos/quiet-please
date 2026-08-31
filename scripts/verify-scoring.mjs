/**
 * Scoring convergence checker — answers "did award-points / re-run work?"
 *
 * For every prediction in the given tournaments it asserts the cron's own
 * invariants:
 *   1. Every correct, non-locked pick with a played result *whose round pays
 *      points* has a point_ledger row for that (match_result, prediction) pair.
 *   2. predictions.points_earned equals SUM(point_ledger.points) for that
 *      prediction.
 *
 * That qualifier in (1) is load-bearing. The cron skips a result outright when
 * its round pays nothing (`if (basePoints <= 0) continue`), and a 250 or 500
 * pays nothing for R64 — the ATP rule. Without the check this script called
 * Winston-Salem 2026 "NOT converged: 807 unscored" forever and told the
 * operator to run award-points, which cannot ever fix it. The paying rounds are
 * read from the real scoring module rather than restated here, so the two
 * cannot disagree.
 *
 * If both hold, scoring is fully converged: nothing left to award, no stale
 * totals. Read-only — safe to run anytime.
 *
 * Usage:
 *   node scripts/verify-scoring.mjs                    # all in_progress + completed tournaments with results
 *   node scripts/verify-scoring.mjs <tournament-id>…   # specific tournaments
 */

import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, join } from 'path'
import { createRequire } from 'module'

// Call the cron's own scoring function rather than restating the points table.
// Same trick as verify-faq-numbers.mjs: compile the module to a temp dir and
// require it, so a retune of POINTS_TABLE reaches this checker automatically.
const repoRoot = resolve(import.meta.dirname, '..')
const compiled = mkdtempSync(join(tmpdir(), 'verify-scoring-'))
execFileSync('npx', [
  'tsc', 'src/lib/tennis/points.ts', 'src/lib/tennis/bracket.ts', 'src/lib/tennis/types.ts',
  '--outDir', compiled, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck',
  '--rootDir', 'src',
], { cwd: repoRoot, stdio: 'inherit' })
const { getPointsForRound } = createRequire(import.meta.url)(join(compiled, 'lib/tennis/points.js'))

/** Does a correct pick on this result earn a ledger row? Mirrors the cron's guards. */
const paysPoints = (category, round) =>
  !!category && !!round && getPointsForRound(category, round, round === 'F') > 0

const envPath = resolve(import.meta.dirname, '..', '.env.local')
const envFile = readFileSync(envPath, 'utf-8')
const env = Object.fromEntries(
  envFile.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const [k, ...rest] = l.split('=')
    return [k.trim(), rest.join('=').trim()]
  })
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function pageAll(query) {
  const rows = []
  let from = 0
  while (true) {
    const { data: page, error } = await query(from, from + 999)
    if (error) { console.error(error.message); process.exit(1) }
    if (!page?.length) break
    rows.push(...page)
    if (page.length < 1000) break
    from += 1000
  }
  return rows
}

// ── Resolve tournament list ───────────────────────────────────────────────────
let tournaments
const argIds = process.argv.slice(2).filter(a => !a.startsWith('--'))
if (argIds.length) {
  const { data, error } = await admin.from('tournaments').select('id, name, location, status, category').in('id', argIds)
  if (error) { console.error(error.message); process.exit(1) }
  tournaments = data ?? []
} else {
  const { data, error } = await admin.from('tournaments')
    .select('id, name, location, status, category')
    .in('status', ['in_progress', 'completed'])
    .order('starts_at', { ascending: false })
  if (error) { console.error(error.message); process.exit(1) }
  tournaments = data ?? []
}

let totalUnscored = 0
let totalDrift = 0

for (const t of tournaments) {
  // Same result filter as the award-points cron: exclude BYEs, keep NULL scores.
  const { data: results, error: resErr } = await admin
    .from('match_results')
    .select('id, external_match_id, winner_external_id, round')
    .eq('tournament_id', t.id)
    .or('score.neq.BYE,score.is.null')
  if (resErr) { console.error(resErr.message); process.exit(1) }
  if (!results?.length) continue  // nothing scoreable yet

  const preds = await pageAll((a, b) => admin.from('predictions')
    .select('id, user_id, picks, locked_picks, points_earned')
    .eq('tournament_id', t.id).range(a, b))

  const ledgerRows = await pageAll((a, b) => admin.from('point_ledger')
    .select('match_result_id, prediction_id, points')
    .eq('tournament_id', t.id).range(a, b))
  const ledgerPairs = new Set(ledgerRows.map(l => `${l.match_result_id}:${l.prediction_id}`))
  const ledgerSumByPred = {}
  for (const l of ledgerRows) ledgerSumByPred[l.prediction_id] = (ledgerSumByPred[l.prediction_id] ?? 0) + l.points

  let correct = 0
  let unpaidCorrect = 0
  const unscored = []
  const drift = []
  for (const p of preds) {
    const locked = new Set(p.locked_picks ?? [])
    for (const r of results) {
      if (locked.has(r.external_match_id)) continue
      if ((p.picks ?? {})[r.external_match_id] === r.winner_external_id) {
        correct++
        // A correct pick in a round that pays nothing is finished work, not
        // pending: the cron never writes it a ledger row, so its absence is
        // expected and can never be resolved by running award-points again.
        if (!paysPoints(t.category, r.round)) { unpaidCorrect++; continue }
        if (!ledgerPairs.has(`${r.id}:${p.id}`)) unscored.push({ user: p.user_id, match: r.external_match_id })
      }
    }
    const expected = ledgerSumByPred[p.id] ?? 0
    if ((p.points_earned ?? 0) !== expected) drift.push({ pred: p.id, stored: p.points_earned, ledger: expected })
  }

  totalUnscored += unscored.length
  totalDrift += drift.length
  const flag = unscored.length || drift.length ? '✗' : '✓'
  const unpaidNote = unpaidCorrect ? `, ${unpaidCorrect} correct in rounds that pay nothing` : ''
  console.log(`${flag} ${t.location ?? t.name} (${t.status}) — ${results.length} results, ${preds.length} predictions, ${correct} correct picks${unpaidNote}, ${unscored.length} unscored, ${drift.length} totals drift`)
  for (const u of unscored.slice(0, 5)) console.log(`    unscored: user ${u.user.slice(0, 8)}… match ${u.match}`)
  for (const d of drift.slice(0, 5)) console.log(`    drift: prediction ${d.pred.slice(0, 8)}… stored=${d.stored} ledger=${d.ledger}`)
}

console.log(totalUnscored + totalDrift === 0
  ? '\n✓ CONVERGED — every correct pick is scored and all totals match the ledger.'
  : `\n✗ NOT converged: ${totalUnscored} unscored correct picks, ${totalDrift} totals drift. Run award-points (or Re-run points per tournament) and check again.`)
