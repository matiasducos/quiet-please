/**
 * Recap checker — answers "does build_tournament_recap() agree with the raw rows?"
 *
 * The recap is ~450 lines of SQL that nothing else in the app cross-checks. A
 * parse check passes on a query that is silently wrong, and so does a logic
 * simulation written from the same assumptions as the query. The only test that
 * catches a real mistake is recomputing the answer from the raw rows, by a
 * different route, over real data.
 *
 * So this reimplements six of the recap's stats in JavaScript — straight from
 * predictions.picks and match_results, no RPC — and asserts they match what the
 * function returned. Where they disagree, one of the two is wrong and both are
 * printed.
 *
 * Read-only. Safe to run anytime.
 *
 * Usage:
 *   node scripts/verify-recap.mjs                    # every stored recap
 *   node scripts/verify-recap.mjs <tournament-id>…   # specific tournaments
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

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

/** Page past PostgREST's 1000-row cap. A big tournament blows through it. */
async function pageAll(build) {
  const rows = []
  let from = 0
  for (;;) {
    const { data, error } = await build(from, from + 999)
    if (error) { console.error('  query failed:', error.message); process.exit(1) }
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return rows
}

async function main() {
  const args = process.argv.slice(2)

  const { data: recapRows, error: recapErr } = await admin
    .from('tournament_recaps')
    .select('tournament_id, payload, built_at')
  if (recapErr) {
    console.error('Could not read tournament_recaps:', recapErr.message)
    console.error('Has migration 076 been applied?')
    process.exit(1)
  }

  const targets = args.length
    ? recapRows.filter(r => args.includes(r.tournament_id))
    : recapRows

  if (!targets.length) {
    console.log('No stored recaps to check.')
    return
  }

  let failures = 0

  for (const { tournament_id: tId, payload } of targets) {
    const { data: t } = await admin
      .from('tournaments').select('name').eq('id', tId).single()
    console.log(`\n── ${t?.name ?? tId} ──`)

    // ── Raw rows ────────────────────────────────────────────────────────────
    const results = await pageAll((a, b) =>
      admin.from('match_results')
        .select('id, external_match_id, round, winner_external_id, loser_external_id, score')
        .eq('tournament_id', tId).range(a, b))

    const preds = await pageAll((a, b) =>
      admin.from('predictions')
        .select('id, picks, locked_picks, points_earned, challenge_id')
        .eq('tournament_id', tId).is('challenge_id', null).range(a, b))

    const ledger = await pageAll((a, b) =>
      admin.from('point_ledger')
        .select('prediction_id, match_result_id, points')
        .eq('tournament_id', tId).range(a, b))

    // The cast — every player appearing in any result, BYE rows included.
    // This is the 064 filter, recomputed here rather than trusted.
    const cast = new Set()
    for (const r of results) {
      if (r.winner_external_id) cast.add(r.winner_external_id)
      if (r.loser_external_id) cast.add(r.loser_external_id)
    }

    const played = results.filter(r => r.score !== 'BYE')
    const byEmid = new Map(played.map(r => [r.external_match_id, r]))

    // ── Recompute ───────────────────────────────────────────────────────────
    let picksMade = 0
    let decided = 0
    let correct = 0
    const pickCount = new Map()          // player -> pick slots naming them
    const perMatch = new Map()           // mrid -> Map(player -> count)
    const bracketCorrect = new Map()     // prediction -> correct count

    for (const p of preds) {
      const locked = new Set(Array.isArray(p.locked_picks) ? p.locked_picks : [])
      for (const [emid, picked] of Object.entries(p.picks ?? {})) {
        if (locked.has(emid)) continue          // 045
        if (!cast.has(picked)) continue         // 064
        picksMade++
        pickCount.set(picked, (pickCount.get(picked) ?? 0) + 1)

        const r = byEmid.get(emid)
        if (!r) continue                        // void pick: counts for popularity, not accuracy
        decided++
        if (!perMatch.has(r.id)) perMatch.set(r.id, new Map())
        const m = perMatch.get(r.id)
        m.set(picked, (m.get(picked) ?? 0) + 1)
        if (picked === r.winner_external_id) {
          correct++
          bracketCorrect.set(p.id, (bracketCorrect.get(p.id) ?? 0) + 1)
        }
      }
    }

    // Points attributed to the match WINNER, not to the current pick.
    const predIds = new Set(preds.map(p => p.id))
    const resultById = new Map(played.map(r => [r.id, r]))
    const playerPoints = new Map()
    let pointsAwarded = 0
    for (const row of ledger) {
      if (!predIds.has(row.prediction_id)) continue   // challenge bracket
      pointsAwarded += row.points
      const r = resultById.get(row.match_result_id)
      if (!r?.winner_external_id) continue
      playerPoints.set(r.winner_external_id, (playerPoints.get(r.winner_external_id) ?? 0) + row.points)
    }

    /**
     * Highest count wins, ties broken by id ascending — the same tie-break the
     * SQL uses, so a genuine two-way tie does not read as a disagreement.
     */
    const topOf = map => [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]

    // Majority pick per match -> upsets, and the crowd bracket.
    let upsets = 0
    let crowdCorrect = 0
    for (const [mrid, counts] of perMatch) {
      const majority = topOf(counts)?.[0]
      if (majority === resultById.get(mrid).winner_external_id) crowdCorrect++
      else upsets++
    }

    // ── Assertions ──────────────────────────────────────────────────────────
    const checks = [
      ['participation.brackets', payload.participation?.brackets, preds.length],
      ['participation.matches', payload.participation?.matches, played.length],
      ['participation.picks_made', payload.participation?.picks_made, picksMade],
      ['participation.points_awarded', payload.participation?.points_awarded, pointsAwarded],
      ['accuracy.decided', payload.accuracy?.decided, decided],
      ['accuracy.correct', payload.accuracy?.correct, correct],
      ['chalk_vs_chaos.upsets', payload.chalk_vs_chaos?.upsets, upsets],
      ['chalk_vs_chaos.decided', payload.chalk_vs_chaos?.decided, perMatch.size],
      ['crowd_bracket.correct', payload.crowd_bracket?.correct, crowdCorrect],
      ['most_picked.player', payload.most_picked?.player?.id, topOf(pickCount)?.[0]],
      ['most_picked.picks', payload.most_picked?.picks, topOf(pickCount)?.[1]],
      ['points_machine.player', payload.points_machine?.player?.id, topOf(playerPoints)?.[0]],
      ['points_machine.points', payload.points_machine?.points, topOf(playerPoints)?.[1]],
    ]

    let bad = 0
    for (const [name, got, want] of checks) {
      // Both absent is agreement: a stat with no data is absent from the
      // payload, and undefined here means the recomputation found none either.
      if (got == null && want == null) continue
      if (Number(got) !== Number(want) && String(got) !== String(want)) {
        console.log(`  ✗ ${name}: recap says ${got}, raw rows say ${want}`)
        bad++
      }
    }

    // An invariant that does not depend on either implementation being right:
    // you cannot call more matches correctly than were played.
    if ((payload.accuracy?.correct ?? 0) > decided) {
      console.log(`  ✗ accuracy.correct (${payload.accuracy.correct}) exceeds decided picks (${decided})`)
      bad++
    }
    // Round accuracies must sum to the overall figure.
    const roundSum = (payload.rounds ?? []).reduce((s, r) => s + r.correct, 0)
    if (payload.accuracy && roundSum !== payload.accuracy.correct) {
      console.log(`  ✗ rounds sum to ${roundSum} correct, accuracy says ${payload.accuracy.correct}`)
      bad++
    }

    if (bad === 0) {
      console.log(`  ✓ ${checks.length} checks passed  (${preds.length} brackets, ${played.length} matches, ${picksMade} picks)`)
    } else {
      failures += bad
    }
  }

  console.log(failures === 0
    ? `\n✓ All recaps agree with the raw rows.`
    : `\n✗ ${failures} disagreement(s). One of the two is wrong.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
