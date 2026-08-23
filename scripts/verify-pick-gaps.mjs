/**
 * Pick-gap checker — answers "does findPickGaps() agree with the raw brackets?"
 *
 * findPickGaps decides whether the site notice nags somebody, and it gets that
 * from a claim worth checking: that "no pickable, unpicked match is left" is the
 * same thing as "predicted all the way to the final". That claim is a fixpoint
 * argument, not an obvious fact, and a fixpoint argument is exactly the kind of
 * thing that reads correctly and is wrong.
 *
 * So this runs two passes. First a hand-computed 8-player fixture, where the
 * right answer was worked out on paper before the code existed. Then every real
 * bracket on every live tournament, asserting two invariants the notice depends
 * on and neither of which the fixture can establish:
 *
 *   1. no gaps  ⇒  the final carries a pick, or has already been played
 *   2. a gap is never reported in a round that is fully played
 *
 * Read-only against the database. Compiles src/lib/tennis/pick-gaps.ts to a
 * temp directory so the real module is exercised, not a copy of it.
 *
 * Usage:
 *   node scripts/verify-pick-gaps.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'child_process'
import { readFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, join } from 'path'

const root = resolve(import.meta.dirname, '..')

const envFile = readFileSync(resolve(root, '.env.local'), 'utf-8')
const env = Object.fromEntries(
  envFile.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const [k, ...rest] = l.split('=')
    return [k.trim(), rest.join('=').trim()]
  })
)

// CommonJS output so Node resolves the extensionless imports tsc leaves alone.
const out = mkdtempSync(join(tmpdir(), 'pick-gaps-'))
execFileSync('npx', [
  'tsc', 'src/lib/tennis/pick-gaps.ts', 'src/lib/tennis/bracket.ts', 'src/lib/tennis/types.ts',
  '--outDir', out, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck',
], { cwd: root, stdio: 'inherit' })

const { createRequire } = await import('module')
const { findPickGaps, toGapMatches } = createRequire(import.meta.url)(join(out, 'pick-gaps.js'))

let failures = 0

// ── 1. Hand-computed fixture ────────────────────────────────────────────────
// Eight players: four quarterfinals (one of them a bye), two semis, a final.
const P = id => ({ externalId: id })
const mk = (matchId, round, player1, player2) => ({ matchId, round, player1, player2 })
const fixture = toGapMatches([
  mk('q1', 'QF', P('a'), P('b')), mk('q2', 'QF', P('c'), P('d')),
  mk('q3', 'QF', P('e'), P('f')), mk('q4', 'QF', P('g'), null),
  mk('s1', 'SF', null, null), mk('s2', 'SF', null, null),
  mk('f1', 'F', null, null),
])
const run = (played, picked) => findPickGaps(fixture, new Set(played), new Set(picked))

const cases = [
  ['fresh draw',  run([], []),
    { nextRound: 'QF', totalMissing: 3 }, 'three real QFs are open; q4 is a bye and is never picked'],
  ['QFs picked',  run([], ['q1', 'q2', 'q3']),
    { nextRound: 'SF', totalMissing: 2 }, 'both semis now resolve — s2 from a pick plus the bye'],
  ['SFs picked',  run([], ['q1', 'q2', 'q3', 's1', 's2']),
    { nextRound: 'F', totalMissing: 1 }, 'only the final is left'],
  ['complete',    run([], ['q1', 'q2', 'q3', 's1', 's2', 'f1']),
    { nextRound: null, totalMissing: 0 }, 'picked through to the final'],
  ['skipped R1',  run(['q1', 'q2', 'q3', 'q4'], []),
    { nextRound: 'SF', totalMissing: 2 }, 'real winners feed forward; the played QFs are gone, not gaps'],
  ['half played', run(['q1', 'q2'], []),
    { nextRound: 'QF', totalMissing: 2 }, 'q3 is open, and s1 opens too because both its feeders were played'],
]

for (const [name, got, want, why] of cases) {
  const ok = got.nextRound === want.nextRound && got.totalMissing === want.totalMissing
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(12)} nextRound=${String(got.nextRound).padEnd(4)} missing=${got.totalMissing}  — ${why}`)
  if (!ok) console.log(`       expected nextRound=${want.nextRound} missing=${want.totalMissing}`)
}

// ── 2. Every real bracket on every live tournament ──────────────────────────
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: live, error: liveError } = await db
  .from('tournaments').select('id, name').eq('status', 'in_progress')
if (liveError) throw liveError

if (!live.length) console.log('\nNo tournament is in progress — the real-row pass has nothing to check.')

for (const t of live) {
  const [{ data: draw }, { data: results }, { data: preds, error: predError }] = await Promise.all([
    db.from('draws').select('bracket_data').eq('tournament_id', t.id).maybeSingle(),
    db.from('match_results').select('external_match_id').eq('tournament_id', t.id),
    db.from('predictions').select('picks, is_fully_locked, users(username)')
      .eq('tournament_id', t.id).is('challenge_id', null),
  ])
  if (predError) throw predError

  const matches = toGapMatches(draw?.bracket_data?.matches ?? [])
  if (!matches.length) { console.log(`\n${t.name}: no draw published, skipped`); continue }

  const played = new Set((results ?? []).map(r => r.external_match_id))
  const finalId = matches.find(m => m.round === 'F')?.matchId
  const fullyPlayedRounds = new Set(
    [...new Set(matches.map(m => m.round))].filter(round =>
      matches.filter(m => m.round === round && !m.isBye).every(m => played.has(m.matchId))),
  )

  const spread = {}
  let wouldSeeIt = 0

  for (const p of preds ?? []) {
    const picks = p.picks ?? {}
    const picked = new Set(Object.keys(picks).filter(k => picks[k]))
    const gaps = findPickGaps(matches, played, picked)

    spread[String(gaps.nextRound)] = (spread[String(gaps.nextRound)] ?? 0) + 1
    if (gaps.nextRound && !p.is_fully_locked) wouldSeeIt++

    if (!gaps.nextRound && finalId && !picked.has(finalId) && !played.has(finalId)) {
      failures++
      console.log(` FAIL  ${p.users?.username}: reported complete, but the final has no pick`)
    }
    if (gaps.nextRound && fullyPlayedRounds.has(gaps.nextRound)) {
      failures++
      console.log(` FAIL  ${p.users?.username}: gap reported in ${gaps.nextRound}, which is fully played`)
    }
  }

  console.log(`\n${t.name}: ${matches.length} matches, ${played.size} played, ${preds?.length ?? 0} brackets`)
  console.log(`  next round to predict: ${JSON.stringify(spread)}`)
  console.log(`  would see the notice (has a gap and is not fully locked): ${wouldSeeIt}`)
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed.')
process.exit(failures ? 1 : 0)
