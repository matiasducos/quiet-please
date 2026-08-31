/**
 * Repairs picks that contradict their own bracket.
 *
 * A pick is INCOHERENT when the player it names is in neither slot of the match
 * — not because they lost, but because the bracket's own earlier picks never
 * send them there. The slot after it then resolves to nobody, so the predictor
 * draws TBD from that point on with nothing saying why.
 *
 * It is NOT the same as a busted pick, and this script must never touch those:
 * a pick whose player was knocked out by a real result is simply wrong, which
 * is allowed and is most of what a bracket looks like by the second week.
 *
 * How it arose: changing an upstream pick clears the downstream picks it
 * invalidates, but it cannot clear a LOCKED one, so the cascade stopped and
 * left it stranded. BracketPredictor now refuses that change instead — this
 * repairs brackets that predate the guard.
 *
 * Repair rule: walk rounds in order and, where a pick names a player who cannot
 * be there, replace it with whoever the bracket's own chain does send through,
 * preferring the slot the stranded player would have occupied. Never touches a
 * played match, and never rewrites a pick that is merely wrong.
 *
 *   node scripts/repair-incoherent-picks.mjs                 # dry run, all brackets
 *   node scripts/repair-incoherent-picks.mjs --id <uuid>     # one bracket
 *   node scripts/repair-incoherent-picks.mjs --id <uuid> --apply
 */

import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'child_process'
import { readFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, join } from 'path'
import { createRequire } from 'module'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const ONLY = args.includes('--id') ? args[args.indexOf('--id') + 1] : null

const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env.local'), 'utf-8').split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const [k, ...r] = l.split('='); return [k.trim(), r.join('=').trim()] }))

const out = mkdtempSync(join(tmpdir(), 'repair-'))
execFileSync('npx', ['tsc', 'src/lib/tennis/bracket.ts', 'src/lib/tennis/types.ts',
  '--outDir', out, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck'],
  { cwd: root, stdio: 'inherit' })
const { buildFeedMap } = createRequire(import.meta.url)(join(out, 'bracket.js'))

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data: tournaments } = await db.from('tournaments')
  .select('id, name').in('status', ['in_progress', 'accepting_predictions'])

let totalFixed = 0, bracketsTouched = 0
for (const t of tournaments ?? []) {
  const [{ data: draw }, { data: res }] = await Promise.all([
    db.from('draws').select('bracket_data').eq('tournament_id', t.id).maybeSingle(),
    db.from('match_results').select('external_match_id, winner_external_id').eq('tournament_id', t.id),
  ])
  if (!draw?.bracket_data?.matches) continue
  let q = db.from('predictions').select('id, picks, users!inner(username)').eq('tournament_id', t.id)
  if (ONLY) q = q.eq('id', ONLY)
  const { data: preds } = await q
  if (!preds?.length) continue

  const matches = draw.bracket_data.matches
  const byId = Object.fromEntries(matches.map(m => [m.matchId, m]))
  const feedMap = buildFeedMap(matches)
  const feedersOf = {}
  for (const [mid, e] of Object.entries(feedMap)) (feedersOf[e.nextMatchId] ??= []).push(mid)
  const results = Object.fromEntries((res ?? []).map(r => [r.external_match_id, r.winner_external_id]))
  const isBye = m => (m.player1 && !m.player2) || (!m.player1 && m.player2)
  const ROUNDS = ['R128','R64','R32','R16','QF','SF','F']

  for (const p of preds) {
    const picks = { ...(p.picks ?? {}) }
    const fixes = []
    for (const round of ROUNDS) {
      for (const m of matches.filter(x => x.round === round)) {
        const fs = feedersOf[m.matchId]
        if (!fs?.length) continue                 // first round: always coherent
        if (results[m.matchId]) continue          // played: never rewrite
        const pick = picks[m.matchId]
        if (!pick) continue
        const occupants = fs.map(f => {
          const fm = byId[f]
          if (fm && isBye(fm)) { const b = fm.player1 ?? fm.player2; return b?.externalId ?? null }
          return results[f] ?? picks[f] ?? null
        })
        const valid = occupants.filter(Boolean)
        if (!valid.length || valid.includes(pick)) continue
        // Keep the side the stranded player would have come from, so a repaired
        // bracket still reads like the one its owner built.
        const idx = fs.findIndex(f => (results[f] ?? picks[f]) !== occupants[fs.indexOf(f)])
        const replacement = valid[idx >= 0 && valid[idx] ? idx : 0]
        picks[m.matchId] = replacement
        fixes.push(`${m.round} ${m.matchId}: ${pick} -> ${replacement}`)
      }
    }
    if (!fixes.length) continue
    bracketsTouched++; totalFixed += fixes.length
    console.log(`\n${p.users.username} · ${t.name} — ${fixes.length} incoherent pick(s)`)
    for (const f of fixes.slice(0, 4)) console.log(`   ${f}`)
    if (fixes.length > 4) console.log(`   … ${fixes.length - 4} more`)
    if (APPLY) {
      const { error } = await db.from('predictions').update({ picks }).eq('id', p.id)
      if (error) console.error(`   FAILED: ${error.message}`)
      else console.log('   applied')
    }
  }
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${totalFixed} picks across ${bracketsTouched} bracket(s)`)
if (!APPLY) console.log('re-run with --apply to write')
