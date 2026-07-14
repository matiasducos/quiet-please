/**
 * One-off repair: fix predictions that picked a QUALIFIER placeholder before
 * the real player was known.
 *
 * Background: picks are stored as `picks[matchId] = playerExternalId`. When a
 * draw sync replaced a "Qualifier" placeholder with the real player, the pick
 * kept the old placeholder id — so the UI showed "Your pick eliminated" and
 * the cron never awarded points. sync-draws now remaps picks at resolution
 * time (src/lib/tennis/qualifier-remap.ts), but picks broken BEFORE that fix
 * shipped are unrecoverable from the draw alone (the old draw was overwritten).
 *
 * This script reconstructs the placeholder → real-player mapping and repairs
 * every affected prediction and anonymous challenge in one tournament:
 *
 *   1. A first-round match currently holds players {A, B}. Predictions that
 *      still contain a placeholder value were made PRE-resolution, so their
 *      pick for that match could only be the placeholder or the named
 *      (non-qualifier) player. If pre-resolution predictions picked exactly
 *      one of {A, B} by real id, that player K was the named slot — so the
 *      placeholder resolves to the OTHER current player.
 *   2. Matches where inference is ambiguous (everyone picked the qualifier,
 *      or conflicting evidence) are listed for MANUAL_MAPPING below.
 *   3. Downstream picks (user advanced the Qualifier past round 1) are
 *      resolved by walking the feeder chain back to the first-round match.
 *
 * DRY-RUN by default — prints the full plan. Re-run with --apply to write.
 * After applying, run "Re-run points" for the tournament in /admin (silent)
 * so ledger rows and streak multipliers are rebuilt from the fixed picks.
 *
 * Usage:
 *   node scripts/backfill-qualifier-picks.mjs <tournament-id>          # dry-run
 *   node scripts/backfill-qualifier-picks.mjs <tournament-id> --apply  # write
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ── Manual overrides for matches the inference can't settle ──────────────────
// matchId → the player who came through qualifying, as externalId OR the exact
// player name as it appears in the draw. Fill from the ATP/WTA qualifying
// results if the dry-run reports ambiguity.
//
// Entries below verified against the 2026 Wikipedia qualifying draws
// (July 14, 2026 repair — see PR #37 follow-up).
const MANUAL_MAPPING = {
  'efg-swiss-open-gstaad-R32-006':          'C. Tabur',
  'nordea-open-R32-006':                    'L. Midon',
  'nordea-open-R32-011':                    'M. Krumich',
  'plava-laguna-croatia-open-umag-R32-011': 'F. A. Gomez',        // N. McDonald was a wildcard
  'internazionali-bnl-ditalia-R128-011':    'C. Garin',
  'internazionali-bnl-ditalia-R128-015':    'N. Basilashvili',
  'internazionali-bnl-ditalia-R128-034':    'J. Fearnley',
  'mutua-madrid-open-R128-003':             'E. Mollerr',         // Cina was a wildcard ('Mollerr' = draw's spelling)
  'mutua-madrid-open-R128-035':             'D. Merida Aguilar',  // official Q; Trungelliti entered as lucky loser
  'terra-wortmann-open-R32-003':            'R. Collignon',
  'terra-wortmann-open-R32-004':            'M. Bellucci',
  'terra-wortmann-open-R32-010':            'N. Basilashvili',
  'terra-wortmann-open-R32-011':            'M. Landaluce',
  'libema-open-R32-014':                    'B. Bonzi',
  '1970-R64-023':                           'C. Garin',           // Monte-Carlo; Arnaldi entered as lucky loser
  // Intentionally unmapped — BOTH players came through qualifying, so a
  // placeholder pick is genuinely ambiguous and stays as-is:
  //   mutua-madrid-open-R128-002 (Bonzi vs Droguet)
  //   lexus-eastbourne-open-R32-015 (Arnaldi vs Hussey)
  //   2270-R32-007 Marrakech (Rocha vs Trungelliti)
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const tournamentId = process.argv[2]
const apply = process.argv.includes('--apply')
if (!tournamentId || tournamentId.startsWith('--')) {
  console.error('Usage: node scripts/backfill-qualifier-picks.mjs <tournament-id> [--apply]')
  process.exit(1)
}

// Load .env.local
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

const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']

const isPlaceholderId = (id) => /^qualifier([-_ ]?\d+)?$/i.test(String(id ?? '').trim())

// ── Load draw + build feed structure (mirrors src/lib/tennis/bracket.ts) ─────

const { data: drawRow, error: drawErr } = await admin
  .from('draws').select('bracket_data').eq('tournament_id', tournamentId).single()
if (drawErr || !drawRow?.bracket_data?.matches) {
  console.error('Could not load draw:', drawErr?.message ?? 'no bracket_data')
  process.exit(1)
}
const matches = drawRow.bracket_data.matches

const byRound = {}
for (const m of matches) (byRound[m.round] ??= []).push(m)
const rounds = ROUND_ORDER.filter(r => byRound[r])
const firstRound = rounds[0]

// reverse feed: `${matchId}` → [feeder1, feeder2]
const feedersOf = {}
for (let ri = 0; ri < rounds.length - 1; ri++) {
  const current = byRound[rounds[ri]]
  const next = byRound[rounds[ri + 1]]
  if (!next?.length) continue
  current.forEach((m, i) => {
    const nm = next[Math.floor(i / 2)]
    if (nm) (feedersOf[nm.matchId] ??= []).push(m.matchId)
  })
}
const matchById = new Map(matches.map(m => [m.matchId, m]))
const firstRoundIds = new Set(byRound[firstRound].map(m => m.matchId))

// ── Load predictions + anonymous challenges (paginated) ──────────────────────

const predictions = []
{
  let from = 0
  while (true) {
    const { data: page, error } = await admin
      .from('predictions').select('id, user_id, challenge_id, picks')
      .eq('tournament_id', tournamentId).range(from, from + 999)
    if (error) { console.error('predictions read:', error.message); process.exit(1) }
    if (!page?.length) break
    predictions.push(...page)
    if (page.length < 1000) break
    from += 1000
  }
}
const { data: challenges, error: challErr } = await admin
  .from('challenges').select('id, is_anonymous, creator_picks, opponent_picks')
  .eq('tournament_id', tournamentId)
if (challErr) { console.error('challenges read:', challErr.message); process.exit(1) }

// All pick-sets: [label, picksObject, writeBack(newPicks)]
const pickSets = [
  ...predictions.map(p => ({
    label: `prediction ${p.id} (user ${p.user_id}${p.challenge_id ? ', challenge' : ', global'})`,
    picks: p.picks ?? {},
    save: (picks) => admin.from('predictions').update({ picks }).eq('id', p.id),
  })),
  ...(challenges ?? []).flatMap(c => [
    c.creator_picks && {
      label: `challenge ${c.id} creator_picks`,
      picks: c.creator_picks,
      save: (picks) => admin.from('challenges').update({ creator_picks: picks }).eq('id', c.id),
    },
    c.opponent_picks && {
      label: `challenge ${c.id} opponent_picks`,
      picks: c.opponent_picks,
      save: (picks) => admin.from('challenges').update({ opponent_picks: picks }).eq('id', c.id),
    },
  ]).filter(Boolean),
]

// ── 1. Infer placeholder → resolved player per first-round match ─────────────

// Pre-resolution pick-sets are the ones still holding a placeholder anywhere.
const preResolution = pickSets.filter(s => Object.values(s.picks).some(isPlaceholderId))
if (preResolution.length === 0) {
  console.log('No stale qualifier picks found — nothing to do.')
  process.exit(0)
}

const mapping = {}       // firstRoundMatchId → resolved player externalId
const ambiguous = []     // matchIds needing MANUAL_MAPPING

for (const m of byRound[firstRound]) {
  const stalePickers = preResolution.filter(s => isPlaceholderId(s.picks[m.matchId]))
  if (stalePickers.length === 0) continue

  const p1 = m.player1?.externalId, p2 = m.player2?.externalId
  if (!p1 || !p2 || isPlaceholderId(p1) || isPlaceholderId(p2)) {
    console.log(`  skip ${m.matchId}: slot not (yet) resolved in current draw`)
    continue
  }
  if (MANUAL_MAPPING[m.matchId]) {
    const v = MANUAL_MAPPING[m.matchId]
    const manual = [m.player1, m.player2].find(p => p?.externalId === v || p?.name === v)
    if (manual) {
      mapping[m.matchId] = manual.externalId
    } else {
      console.log(`  ⚠ MANUAL_MAPPING for ${m.matchId}: '${v}' matches neither player — check spelling`)
      ambiguous.push({ matchId: m.matchId, players: [m.player1?.name, m.player2?.name] })
    }
    continue
  }
  // Real-id picks for this match among PRE-resolution sets identify the named slot.
  const knownReal = new Set(
    preResolution.map(s => s.picks[m.matchId]).filter(v => v === p1 || v === p2)
  )
  if (knownReal.size === 1) {
    const named = [...knownReal][0]
    mapping[m.matchId] = named === p1 ? p2 : p1
  } else {
    ambiguous.push({ matchId: m.matchId, players: [m.player1?.name, m.player2?.name] })
  }
}

console.log(`\nDraw: ${matches.length} matches, first round ${firstRound}`)
console.log(`Pick-sets: ${pickSets.length} total, ${preResolution.length} with stale qualifier picks`)
console.log('\nInferred qualifier resolutions:')
for (const [mid, pid] of Object.entries(mapping)) {
  const m = matchById.get(mid)
  const name = [m.player1, m.player2].find(p => p?.externalId === pid)?.name ?? pid
  console.log(`  ${mid} → ${name} (${pid})`)
}
if (ambiguous.length) {
  console.log('\n⚠ AMBIGUOUS — add these to MANUAL_MAPPING (who was the qualifier?):')
  for (const a of ambiguous) console.log(`  ${a.matchId}: ${a.players.join(' vs ')}`)
}

// ── 2. Build per-pick-set repairs (first round + downstream feeder walk) ─────

// For a downstream match holding a placeholder pick, follow the feeder whose
// pick carries the same placeholder value back to its first-round origin.
function resolveOrigin(picks, matchId, value) {
  if (firstRoundIds.has(matchId)) return matchId
  const feeders = feedersOf[matchId] ?? []
  const carrying = feeders.filter(f => picks[f] === value)
  if (carrying.length !== 1) return null  // broken/ambiguous chain — leave as-is
  return resolveOrigin(picks, carrying[0], value)
}

let repaired = 0, entriesFixed = 0, unresolvable = 0
const updates = []
for (const s of preResolution) {
  const next = { ...s.picks }
  let changed = false
  for (const [mid, v] of Object.entries(next)) {
    if (!isPlaceholderId(v)) continue
    const origin = resolveOrigin(next, mid, v)
    const resolved = origin ? mapping[origin] : null
    if (resolved) {
      next[mid] = resolved
      changed = true
      entriesFixed++
    } else {
      unresolvable++
      console.log(`  ⚠ unresolved: ${s.label} — picks[${mid}] = ${v}`)
    }
  }
  if (changed) {
    repaired++
    updates.push({ s, next })
    console.log(`  fix ${s.label}: ${Object.entries(next).filter(([k, val]) => s.picks[k] !== val).map(([k, val]) => `${k}: ${s.picks[k]} → ${val}`).join(', ')}`)
  }
}

console.log(`\nPlan: repair ${entriesFixed} pick entr${entriesFixed === 1 ? 'y' : 'ies'} across ${repaired} pick-set(s); ${unresolvable} unresolvable`)

if (!apply) {
  console.log('\nDRY-RUN — nothing written. Re-run with --apply to write.')
  process.exit(0)
}

for (const { s, next } of updates) {
  const { error } = await s.save(next)
  if (error) console.error(`  ✗ ${s.label}: ${error.message}`)
}
console.log(`\n✓ Applied. Now open /admin → Award Points → "Re-run points" for this tournament`)
console.log('  (silent re-run rebuilds ledger rows + streak multipliers from the fixed picks).')
