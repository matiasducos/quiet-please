/**
 * Import past editions as evergreen search inventory.
 *
 * Why this exists: every tournament in the database is from the current
 * season, so the site has no answer for "who won Wimbledon 2025" — a query
 * that never stops being asked, unlike a live draw which is worth nothing
 * three weeks later. Each past edition is a page that keeps earning.
 *
 * What an edition actually needs is much less than a live one. The champion is
 * derived from a `match_results` row with `round = 'F'`, and the edition page
 * resolves player names against the `players` table when there is no draw
 * (see resolveMissingPlayers in src/lib/tournaments/series.ts). So one
 * tournament row plus one final result is a complete, correct page. The
 * participants block and the SportsEvent `competitor` list simply don't render
 * without a draw, which is the right failure: thin, but nothing invented.
 *
 * On accuracy: every champion, runner-up and date below was verified against
 * that edition's own Wikipedia article, not recalled. These pages exist to
 * answer a factual question, so a wrong answer is worse than no page. Scores
 * are deliberately absent — `match_results.score` is NULL for every row in
 * this database already, and inventing one would be worse than omitting it.
 *
 *   node scripts/import-historical-editions.mjs            # dry run (default)
 *   node scripts/import-historical-editions.mjs --apply    # write
 *
 * Idempotent: tournaments key on `external_id`, results on
 * `external_match_id`, so re-running updates rather than duplicating.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const envPath = resolve(import.meta.dirname, '..', '.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf-8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
)

const APPLY = process.argv.includes('--apply')

// ── The series ──────────────────────────────────────────────────────────────
// Keyed by the series slug, which is what /tournaments/<slug>/<year> resolves.
// `tournamentName` is the name on the tournament row; `seriesName` drives the
// page H1 as "<seriesName> <year>", so it is the phrase people actually search
// — "French Open 2025" rather than the official "Roland Garros".
//
// `category` and `drawSize` are per-series rather than assumed: this started as
// a Grand Slam importer, and a 500 with a 32-player draw filed as a 128-player
// major would put a wrong figure on the page and wrong points in the table.
const SERIES = {
  'australian-open': {
    seriesName: 'Australian Open',
    tournamentName: 'Australian Open',
    externalSlug: 'australian-open',
    city: 'Melbourne',
    country: 'Australia',
    location: 'Melbourne, Australia',
    flag: '🇦🇺',
    surface: 'hard',
    category: 'grand_slam',
    drawSize: 128,
  },
  'french-open': {
    seriesName: 'French Open',
    tournamentName: 'Roland Garros',
    externalSlug: 'roland-garros',
    city: 'Paris',
    country: 'France',
    location: 'Paris, France',
    flag: '🇫🇷',
    surface: 'clay',
    category: 'grand_slam',
    drawSize: 128,
  },
  wimbledon: {
    seriesName: 'Wimbledon',
    tournamentName: 'Wimbledon',
    externalSlug: 'wimbledon',
    city: 'London',
    country: 'United Kingdom',
    location: 'London, United Kingdom',
    flag: '🇬🇧',
    surface: 'grass',
    category: 'grand_slam',
    drawSize: 128,
  },
  'us-open': {
    seriesName: 'US Open',
    tournamentName: 'US Open',
    externalSlug: 'us-open',
    city: 'New York',
    country: 'United States',
    location: 'New York, United States',
    flag: '🇺🇸',
    surface: 'hard',
    category: 'grand_slam',
    drawSize: 128,
  },
  // An ATP 500, not a major — and the reason this map carries category and
  // draw size at all. Search Console has its cluster at 63% of all site
  // impressions sitting in position 49, on a hub that promises "Past Winners"
  // and has none.
  'tokyo-open': {
    seriesName: 'Tokyo Open',
    tournamentName: 'Japan Open Tennis Championships',
    externalSlug: 'tokyo-open',
    city: 'Tokyo',
    country: 'Japan',
    location: 'Tokyo, Japan',
    flag: '🇯🇵',
    surface: 'hard',
    category: '500',
    drawSize: 32,
  },
}

// ── Players ─────────────────────────────────────────────────────────────────
// Real feed ids, looked up from the `players` table rather than invented. An
// invented id would collide the day the api-tennis feed is switched back on,
// and would also fail to resolve a name on the page.
const PLAYER = {
  alcaraz: '2382',
  sinner: '2072',
  djokovic: '1905',
  medvedev: '1093',
  zverev: '1980',
  fritz: '2832',
  ruud: '430',
  nadal: '2170',
  tsitsipas: '1906',
  berrettini: '2844',
  kyrgios: '2984',
  tiafoe: '2846',
  shelton: '2973',
  karatsev: '1901',
  fils: '1759',
  humbert: '1105',
}

// ── The editions ────────────────────────────────────────────────────────────
// Dates are the full tournament run from each edition's Wikipedia infobox.
// `played_at` for the final is the closing date, which is when the final is
// played.
const EDITIONS = [
  // US Open goes deeper than the rest on purpose: Search Console shows the
  // "us open bracket" cluster carrying 28% of all impressions at position 25,
  // and it is the one query with a deadline — the tournament starts 30 Aug.
  // Depth on the series its landing page and hub already rank for is worth
  // more right now than a first edition of somewhere else.
  { slug: 'us-open',         year: 2021, starts: '2021-08-30', ends: '2021-09-12', champion: PLAYER.medvedev, runnerUp: PLAYER.djokovic },
  { slug: 'us-open',         year: 2022, starts: '2022-08-29', ends: '2022-09-11', champion: PLAYER.alcaraz,  runnerUp: PLAYER.ruud },
  { slug: 'us-open',         year: 2023, starts: '2023-08-28', ends: '2023-09-10', champion: PLAYER.djokovic, runnerUp: PLAYER.medvedev },

  // NOTE: the 2021 Australian Open ran in FEBRUARY, not its usual January —
  // quarantine pushed the whole swing back. Exactly the kind of detail that
  // comes out wrong when dates are filled in from the usual pattern instead of
  // from the edition's own record.
  { slug: 'australian-open', year: 2021, starts: '2021-02-08', ends: '2021-02-21', champion: PLAYER.djokovic, runnerUp: PLAYER.medvedev },
  { slug: 'australian-open', year: 2022, starts: '2022-01-17', ends: '2022-01-30', champion: PLAYER.nadal,    runnerUp: PLAYER.medvedev },
  { slug: 'australian-open', year: 2023, starts: '2023-01-16', ends: '2023-01-29', champion: PLAYER.djokovic, runnerUp: PLAYER.tsitsipas },

  { slug: 'french-open',     year: 2021, starts: '2021-05-30', ends: '2021-06-13', champion: PLAYER.djokovic, runnerUp: PLAYER.tsitsipas },
  { slug: 'french-open',     year: 2022, starts: '2022-05-22', ends: '2022-06-05', champion: PLAYER.nadal,    runnerUp: PLAYER.ruud },
  { slug: 'french-open',     year: 2023, starts: '2023-05-28', ends: '2023-06-11', champion: PLAYER.djokovic, runnerUp: PLAYER.ruud },

  { slug: 'wimbledon',       year: 2021, starts: '2021-06-28', ends: '2021-07-11', champion: PLAYER.djokovic, runnerUp: PLAYER.berrettini },
  { slug: 'wimbledon',       year: 2022, starts: '2022-06-27', ends: '2022-07-10', champion: PLAYER.djokovic, runnerUp: PLAYER.kyrgios },
  { slug: 'wimbledon',       year: 2023, starts: '2023-07-03', ends: '2023-07-16', champion: PLAYER.alcaraz,  runnerUp: PLAYER.djokovic },

  // Tokyo carries 63% of the site's search impressions on one hub sitting in
  // position 49 with a single unplayed edition behind it, while "tokyo open
  // 2025" is itself one of the queries being served nothing.
  //
  // 2020 and 2021 are absent on purpose: the tournament was not held either
  // year because of the pandemic. Minting an edition to fill the gap would
  // invent an event that never happened.
  { slug: 'tokyo-open',      year: 2022, starts: '2022-10-03', ends: '2022-10-09', champion: PLAYER.fritz,   runnerUp: PLAYER.tiafoe },
  { slug: 'tokyo-open',      year: 2023, starts: '2023-10-16', ends: '2023-10-22', champion: PLAYER.shelton, runnerUp: PLAYER.karatsev },
  { slug: 'tokyo-open',      year: 2024, starts: '2024-09-25', ends: '2024-10-01', champion: PLAYER.fils,    runnerUp: PLAYER.humbert },
  { slug: 'tokyo-open',      year: 2025, starts: '2025-09-24', ends: '2025-09-30', champion: PLAYER.alcaraz, runnerUp: PLAYER.fritz },

  { slug: 'australian-open', year: 2024, starts: '2024-01-14', ends: '2024-01-28', champion: PLAYER.sinner,  runnerUp: PLAYER.medvedev },
  { slug: 'french-open',     year: 2024, starts: '2024-05-26', ends: '2024-06-09', champion: PLAYER.alcaraz, runnerUp: PLAYER.zverev },
  { slug: 'wimbledon',       year: 2024, starts: '2024-07-01', ends: '2024-07-14', champion: PLAYER.alcaraz, runnerUp: PLAYER.djokovic },
  { slug: 'us-open',         year: 2024, starts: '2024-08-26', ends: '2024-09-08', champion: PLAYER.sinner,  runnerUp: PLAYER.fritz },
  { slug: 'australian-open', year: 2025, starts: '2025-01-12', ends: '2025-01-26', champion: PLAYER.sinner,  runnerUp: PLAYER.zverev },
  { slug: 'french-open',     year: 2025, starts: '2025-05-25', ends: '2025-06-08', champion: PLAYER.alcaraz, runnerUp: PLAYER.sinner },
  { slug: 'wimbledon',       year: 2025, starts: '2025-06-30', ends: '2025-07-13', champion: PLAYER.sinner,  runnerUp: PLAYER.alcaraz },
  { slug: 'us-open',         year: 2025, starts: '2025-08-24', ends: '2025-09-07', champion: PLAYER.alcaraz, runnerUp: PLAYER.sinner },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

const iso = d => `${d}T00:00:00+00:00`

async function playerNames() {
  const ids = [...new Set(EDITIONS.flatMap(e => [e.champion, e.runnerUp]))]
  const { data, error } = await admin.from('players').select('external_id, name').in('external_id', ids)
  if (error) throw new Error(`player lookup failed: ${error.message}`)
  const found = new Map((data ?? []).map(p => [p.external_id, p.name]))
  const missing = ids.filter(id => !found.has(id))
  if (missing.length) throw new Error(`players not in the registry: ${missing.join(', ')} — the page could not name them`)
  return found
}

/** Series row, created only when absent. Returns its id. */
async function ensureSeries(slug) {
  const meta = SERIES[slug]
  const { data: existing, error } = await admin
    .from('tournament_series')
    .select('id, slug, name')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(`series lookup failed: ${error.message}`)
  if (existing) return { id: existing.id, created: false }

  if (!APPLY) return { id: '(new)', created: true }

  const { data, error: insErr } = await admin
    .from('tournament_series')
    .insert({
      slug,
      name: meta.seriesName,
      short_name: meta.seriesName,
      city: meta.city,
      country: meta.country,
      flag_emoji: meta.flag,
      surface: meta.surface,
      category: meta.category,
      // Reviewed on purpose: the slug is chosen here by a human, not guessed by
      // the sync cron, and an unreviewed series is kept noindex and out of the
      // sitemap — which would defeat the entire point of importing these.
      slug_reviewed: true,
    })
    .select('id')
    .single()
  if (insErr) throw new Error(`series insert failed: ${insErr.message}`)
  return { id: data.id, created: true }
}

// ── Run ─────────────────────────────────────────────────────────────────────

const names = await playerNames()
console.log(APPLY ? '── APPLYING ──\n' : '── DRY RUN (pass --apply to write) ──\n')

const seriesIds = {}
for (const slug of new Set(EDITIONS.map(e => e.slug))) {
  const { id, created } = await ensureSeries(slug)
  seriesIds[slug] = id
  console.log(`series ${slug.padEnd(18)} ${created ? 'CREATE' : 'exists'}  ${id}`)
}
console.log()

let tCreated = 0, tUpdated = 0, rWritten = 0
for (const e of EDITIONS) {
  const meta = SERIES[e.slug]
  const externalId = `${meta.externalSlug}-${e.year}`
  const matchId = `${meta.externalSlug}-${e.year}-F-001`

  const tournament = {
    external_id: externalId,
    name: meta.tournamentName,
    tour: 'ATP',
    category: meta.category,
    surface: meta.surface,
    starts_at: iso(e.starts),
    ends_at: iso(e.ends),
    starts_year: e.year,
    status: 'completed',
    location: meta.location,
    flag_emoji: meta.flag,
    draw_size: meta.drawSize,
    is_manual: true,
    series_id: seriesIds[e.slug],
    completed_at: iso(e.ends),
  }

  const { data: existing } = await admin
    .from('tournaments')
    .select('id')
    .eq('external_id', externalId)
    .maybeSingle()

  const label = `${meta.seriesName} ${e.year}`.padEnd(24)
  const line = `${names.get(e.champion)} def. ${names.get(e.runnerUp)}`

  if (!APPLY) {
    console.log(`${existing ? 'update' : 'CREATE'}  ${label} ${e.starts} → ${e.ends}  ${line}`)
    console.log(`        /tournaments/${e.slug}/${e.year}`)
    continue
  }

  let tournamentId = existing?.id
  if (existing) {
    const { error } = await admin.from('tournaments').update(tournament).eq('id', existing.id)
    if (error) throw new Error(`tournament update failed (${externalId}): ${error.message}`)
    tUpdated++
  } else {
    const { data, error } = await admin.from('tournaments').insert(tournament).select('id').single()
    if (error) throw new Error(`tournament insert failed (${externalId}): ${error.message}`)
    tournamentId = data.id
    tCreated++
  }

  // The final. This single row is what makes the champion block, the page
  // description and the series-hub champion column all resolve.
  const { data: existingResult } = await admin
    .from('match_results')
    .select('id')
    .eq('external_match_id', matchId)
    .maybeSingle()

  const result = {
    tournament_id: tournamentId,
    external_match_id: matchId,
    round: 'F',
    winner_external_id: e.champion,
    loser_external_id: e.runnerUp,
    // Left NULL on purpose — see the note at the top of this file.
    score: null,
    played_at: iso(e.ends),
  }

  if (existingResult) {
    const { error } = await admin.from('match_results').update(result).eq('id', existingResult.id)
    if (error) throw new Error(`result update failed (${matchId}): ${error.message}`)
  } else {
    const { error } = await admin.from('match_results').insert(result)
    if (error) throw new Error(`result insert failed (${matchId}): ${error.message}`)
  }
  rWritten++

  console.log(`${existing ? 'updated' : 'created'} ${label} ${line}`)
  console.log(`        /tournaments/${e.slug}/${e.year}`)
}

console.log()
if (APPLY) {
  console.log(`tournaments created: ${tCreated}, updated: ${tUpdated}`)
  console.log(`final results written: ${rWritten}`)
} else {
  console.log(`${EDITIONS.length} editions would be written. Re-run with --apply.`)
}
