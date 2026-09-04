/**
 * Stacking-rule checker — "does requiring a commitment to predate the feeder
 * result change anything it should not, and does it change what it should?"
 *
 * The multiplier now counts a link only when the pick was committed BEFORE the
 * feeder match was decided, so that predicting on top of your own projection
 * outscores waiting for a round to resolve and re-picking the winner.
 *
 * Two properties, and BOTH are needed. Either alone is misleading:
 *
 *   A. FORWARD-ONLY — replayed over every real prediction on every completed
 *      tournament, the new rule must change NOTHING. `pick_lock_times` is empty
 *      for everything committed before migration 099, and a link with no
 *      recorded lock time falls through to the old rule. Nobody's history is
 *      repriced by a re-run.
 *
 *   B. IT ACTUALLY BITES — property A is also what a no-op would report, so the
 *      same brackets are replayed again with SYNTHETIC lock times: once dated
 *      before every feeder result (stacked — multiplier must be unchanged from
 *      today), once dated after (result-following — multiplier must collapse
 *      to 1 wherever the old rule had given more).
 *
 * Read-only. Safe to run anytime.
 *
 *   node scripts/verify-stacking-rule.mjs
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

const out = mkdtempSync(join(tmpdir(), 'stacking-'))
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

const EARLY = '2000-01-01T00:00:00.000Z'   // before every feeder result
const LATE  = '2099-01-01T00:00:00.000Z'   // after every feeder result

let scored = 0
let realChanged = 0                         // property A — must be 0
let stackedChanged = 0                      // property B1 — must be 0
let followDropped = 0, followSame = 0       // property B2 — drops must be > 0
let windowChecked = 0, windowDenied = 0, windowMissed = 0   // property C
let gradeChecked = 0, gradeDropped = 0, gradeFlat = 0       // property D
const examples = []

for (const t of tournaments) {
  const [{ data: draw }, { data: results }, { data: preds }] = await Promise.all([
    db.from('draws').select('bracket_data, locked_matches').eq('tournament_id', t.id).maybeSingle(),
    db.from('match_results').select('external_match_id, winner_external_id, score, played_at')
      .eq('tournament_id', t.id),
    // Tolerates pick_lock_times not existing yet: before 099 is applied the
    // column is absent and every bracket's real lock times are {} anyway, which
    // is precisely the state property A has to hold for.
    db.from('predictions')
      .select('id, picks, pick_locks, pick_lock_times, locked_picks, is_fully_locked')
      .eq('tournament_id', t.id)
      .then(r => r.error
        ? db.from('predictions')
            .select('id, picks, pick_locks, locked_picks, is_fully_locked')
            .eq('tournament_id', t.id)
        : r),
  ])
  if (!draw?.bracket_data?.matches || !results?.length || !preds?.length) continue

  const matches = draw.bracket_data.matches
  const feedMap = buildFeedMap(matches)
  const playedAt = Object.fromEntries(
    results.filter(r => r.played_at).map(r => [r.external_match_id, r.played_at]))
  const adminLockedAt = draw.locked_matches ?? {}

  for (const p of preds) {
    const picks = p.picks ?? {}
    const locked = new Set(Array.isArray(p.locked_picks) ? p.locked_picks : [])
    const committed = committedPicks(p.pick_locks ?? {})
    const realTimes = p.pick_lock_times ?? {}
    // synthetic maps covering every match this bracket committed to
    const early = Object.fromEntries([...committed].map(m => [m, EARLY]))
    const late  = Object.fromEntries([...committed].map(m => [m, LATE]))

    for (const r of results) {
      if (r.score === 'BYE') continue
      if (picks[r.external_match_id] !== r.winner_external_id) continue
      scored++
      const args = [r.external_match_id, r.winner_external_id, picks, feedMap, matches, locked, committed]

      const base    = calculateStreakMultiplier(...args)
      const withReal= calculateStreakMultiplier(...args, realTimes, playedAt, adminLockedAt)
      const asStack = calculateStreakMultiplier(...args, early, playedAt, adminLockedAt)
      const asFollow= calculateStreakMultiplier(...args, late, playedAt, adminLockedAt)

      // C. The admin-lock half. Find this pick's first chain link, and if the
      // feeder was locked by the organiser BEFORE its result was entered, time a
      // commitment inside that window: legitimate under played_at alone, and
      // denied once the organiser's lock counts. Everything else stays EARLY so
      // only this one link can move the answer.
      const feederId = Object.keys(feedMap).find(f =>
        feedMap[f].nextMatchId === r.external_match_id && picks[f] === r.winner_external_id)
      const lockAt = feederId ? adminLockedAt[feederId] : undefined
      const playAt = feederId ? playedAt[feederId] : undefined
      if (lockAt && playAt && Date.parse(lockAt) < Date.parse(playAt)) {
        const mid = new Date((Date.parse(lockAt) + Date.parse(playAt)) / 2).toISOString()
        const inWindow = { ...early, [r.external_match_id]: mid }
        const allowed = calculateStreakMultiplier(...args, inWindow, playedAt)                 // result only
        const denied  = calculateStreakMultiplier(...args, inWindow, playedAt, adminLockedAt)  // + admin lock
        windowChecked++
        if (denied < allowed) windowDenied++
        else if (allowed > 1) windowMissed++
      }

      // D. The anchored rule. Every link is judged against when THIS pick was
      // committed, so a run assembled a round at a time — each pick blind only
      // to the round directly beneath it — must NOT score the same as one
      // called blind to all of them.
      //
      // Built by walking this pick's own chain, taking the DEEPEST feeder in
      // it (the earliest to be decided) and dating the commitment just after
      // that one resolved. Exactly one link should die: the deepest. Under the
      // walking rule it survives, because it was judged against its own pick's
      // EARLY time rather than against this one — which is the whole bug, and
      // why this property fails on the previous implementation.
      const chain = []
      {
        let cur = r.external_match_id
        while (true) {
          const f = Object.keys(feedMap).find(x =>
            feedMap[x].nextMatchId === cur && picks[x] === r.winner_external_id)
          if (!f) break
          chain.push(f)
          cur = f
        }
      }
      const decidedTimes = chain
        .map(f => { const l = adminLockedAt[f], q = playedAt[f]
          return [l, q].filter(Boolean).sort()[0] })
        .filter(Boolean)
      if (chain.length >= 2 && decidedTimes.length === chain.length) {
        const deepest = decidedTimes.sort()[0]                     // earliest to resolve
        const justAfter = new Date(Date.parse(deepest) + 1000).toISOString()
        const blind   = calculateStreakMultiplier(...args, early, playedAt, adminLockedAt)
        const partial = calculateStreakMultiplier(
          ...args, { ...early, [r.external_match_id]: justAfter }, playedAt, adminLockedAt)
        // Only chains where every link actually counts. Otherwise the link
        // this dates out may be one the trace never reached — already cut off
        // by an uncommitted or stranded pick further up — and nothing moves,
        // which says nothing either way about the rule under test.
        if (blind >= 2 && blind === chain.length + 1) {
          gradeChecked++
          if (partial < blind) gradeDropped++
          else {
            gradeFlat++
            if (examples.length < 15) examples.push(
              `GRADE FLAT ${t.name} pred=${p.id} ${r.external_match_id}: blind=${blind} partial=${partial} chain=${chain.length}`)
          }
        }
      }

      if (withReal !== base) {
        realChanged++
        if (examples.length < 5) examples.push(`REAL DRIFT ${t.name} pred=${p.id} ${r.external_match_id}: ${base} -> ${withReal}`)
      }
      if (asStack !== base) {
        stackedChanged++
        if (examples.length < 10) examples.push(`STACKED DRIFT ${t.name} ${r.external_match_id}: ${base} -> ${asStack}`)
      }
      if (asFollow < base) followDropped++
      else if (asFollow === base) followSame++
    }
  }
}

console.log(`\nscored picks replayed: ${scored}`)
console.log(`\nA. real data, new rule vs old      : ${realChanged} changed   (must be 0)`)
console.log(`B1. synthetic "committed early"    : ${stackedChanged} changed   (must be 0)`)
console.log(`B2. synthetic "committed late"     : ${followDropped} dropped to a lower multiplier, ${followSame} unchanged`)
console.log(`    (dropped must be > 0, or the new rule is dead code)`)
console.log(`\nC. committed AFTER the organiser locked the feeder but BEFORE the result`)
console.log(`   was entered — the window this change closes:`)
console.log(`   ${windowChecked} such links found, ${windowDenied} now denied, ${windowMissed} still allowed (must be 0)`)
console.log(`\nD. a run assembled one round at a time must not score as a blind call:`)
console.log(`   ${gradeChecked} chains tested, ${gradeDropped} pay less once a round below had resolved,`)
console.log(`   ${gradeFlat} unchanged (must be 0 — that is the walking rule's signature)`)
if (examples.length) console.log('\n' + examples.join('\n'))

const ok = realChanged === 0 && stackedChanged === 0 && followDropped > 0 && windowMissed === 0
  && gradeChecked > 0 && gradeFlat === 0
console.log(`\n${ok ? 'PASS' : 'FAIL'}`)
process.exit(ok ? 0 : 1)
