import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import type { BracketData } from '@/lib/tournaments/series'
import type { SlamConfig } from './config'

const TOURNAMENT_FIELDS =
  'id, name, tour, surface, category, starts_at, ends_at, status, location, flag_emoji, starts_year'

export type SlamTournament = {
  id: string
  name: string
  tour: string
  surface: string | null
  category: string
  starts_at: string | null
  ends_at: string | null
  status: string
  location: string | null
  flag_emoji: string | null
  starts_year: number | null
}

/**
 * Which of the four page states to render.
 * - `live`     — matches under way; brackets are locked per match as they start
 * - `open`     — draw published, picks being accepted. The conversion moment.
 * - `upcoming` — edition scheduled but the draw is not out yet
 * - `offseason`— no scheduled edition; the page stays useful and indexed anyway
 */
export type SlamPhase = 'live' | 'open' | 'upcoming' | 'offseason'

export type SlamEditions = {
  phase: SlamPhase
  /** Current (or next) edition, split by tour. Either may be null — the WTA
   *  rows genuinely don't exist yet, so the UI must degrade rather than assume. */
  atp: SlamTournament | null
  wta: SlamTournament | null
  /** Year of the edition in `atp`/`wta`, when there is one. */
  year: number | null
  /** Earliest start among the current edition's rows, for countdown copy. */
  nextStartsAt: string | null
  /** Most recent completed edition, used to link to results in the off-season. */
  lastCompleted: SlamTournament | null
}

/**
 * All Grand Slam rows, cached once and shared by every slam page.
 *
 * Fetching the whole category and filtering by name in memory is deliberate.
 * There is no slug column, so slams can only be identified by fuzzy name match
 * — and PostgREST's `.or(...ilike...)` string syntax is easy to get subtly
 * wrong with multi-word patterns like "roland garros". The result set is
 * inherently tiny (at most 8 rows per season: 4 slams x 2 tours), so LIMIT 200
 * covers ~25 years and stays far clear of the 1000-row cap that silently
 * truncates PostgREST responses.
 */
const getAllSlamTournaments = unstable_cache(
  async (): Promise<SlamTournament[]> => {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tournaments')
      .select(TOURNAMENT_FIELDS)
      .eq('category', 'grand_slam')
      .order('starts_at', { ascending: false })
      .limit(200)
    if (error) {
      console.error('[slams] failed to load grand slam tournaments:', error.message)
      return []
    }
    return (data ?? []) as SlamTournament[]
  },
  ['slam-tournaments'],
  { revalidate: 300, tags: ['tournament-list'] },
)

/** Statuses where a bracket can still be filled in. */
const OPEN_STATUSES = new Set(['draw_published', 'accepting_predictions'])

function matchesSlam(t: SlamTournament, config: SlamConfig): boolean {
  const name = (t.name ?? '').toLowerCase()
  return config.matchNames.some(fragment => name.includes(fragment))
}

/** Year for a row, preferring the denormalised column and falling back to the date. */
function yearOf(t: SlamTournament): number | null {
  if (t.starts_year != null) return t.starts_year
  return t.starts_at ? new Date(t.starts_at).getUTCFullYear() : null
}

export async function getSlamEditions(config: SlamConfig): Promise<SlamEditions> {
  const all = await getAllSlamTournaments()
  const mine = all.filter(t => matchesSlam(t, config))

  const completed = mine.filter(t => t.status === 'completed')
  const active = mine.filter(t => t.status !== 'completed')

  const lastCompleted =
    completed.length > 0
      // `mine` is already sorted starts_at desc, so the first completed row is the latest.
      ? completed[0]
      : null

  if (active.length === 0) {
    return { phase: 'offseason', atp: null, wta: null, year: null, nextStartsAt: null, lastCompleted }
  }

  // Scope to a single edition: the soonest-starting non-completed year. Without
  // this, a row for next year's event could be mixed with this year's.
  const activeSorted = [...active].sort((a, b) => {
    const at = a.starts_at ? Date.parse(a.starts_at) : Number.POSITIVE_INFINITY
    const bt = b.starts_at ? Date.parse(b.starts_at) : Number.POSITIVE_INFINITY
    return at - bt
  })
  const year = yearOf(activeSorted[0])
  const edition = activeSorted.filter(t => yearOf(t) === year)

  const atp = edition.find(t => t.tour === 'ATP') ?? null
  const wta = edition.find(t => t.tour === 'WTA') ?? null

  let phase: SlamPhase = 'upcoming'
  if (edition.some(t => t.status === 'in_progress')) phase = 'live'
  else if (edition.some(t => OPEN_STATUSES.has(t.status))) phase = 'open'

  return {
    phase,
    atp,
    wta,
    year,
    nextStartsAt: activeSorted[0].starts_at,
    lastCompleted,
  }
}

/**
 * Named players in the current edition's draws, for the page's SportsEvent
 * `performer`.
 *
 * Capped hard: a slam is a 128-draw per tour and this JSON-LD ships inline in
 * every byte of the HTML, so the whole field would cost more than the rich
 * result it unlocks. Players the draw snapshot could not name are dropped
 * rather than resolved through the player registry — a second round trip to
 * name entrants nobody will read, on a page whose point is the CTA.
 */
const MAX_PERFORMERS = 30

export async function getSlamPerformers(editions: SlamEditions): Promise<string[]> {
  const ids = [editions.atp?.id, editions.wta?.id].filter(Boolean) as string[]
  if (ids.length === 0) return []

  return unstable_cache(
    async (): Promise<string[]> => {
      const supabase = createAdminClient()
      const { data, error } = await supabase
        .from('draws')
        .select('bracket_data')
        .in('tournament_id', ids)
      if (error) {
        console.error('[slams] failed to load draws for performers:', error.message)
        return []
      }

      const names = new Set<string>()
      for (const row of (data ?? []) as { bracket_data: BracketData | null }[]) {
        for (const match of row.bracket_data?.matches ?? []) {
          for (const player of [match?.player1, match?.player2]) {
            if (player?.name) names.add(player.name)
          }
        }
      }
      return [...names].sort((a, b) => a.localeCompare(b)).slice(0, MAX_PERFORMERS)
    },
    ['slam-performers', ...ids],
    { revalidate: 300, tags: ['tournament-detail', 'tournament-list'] },
  )()
}

/**
 * Human-readable estimate of the next edition, for the off-season state where
 * no row exists yet. Uses the config's usual start month rather than inventing
 * a precise date the tournament has not announced.
 */
export function estimateNextEdition(config: SlamConfig, now: Date = new Date()): string {
  const currentYear = now.getUTCFullYear()
  // If this year's window has already passed, point at next year.
  const year = now.getUTCMonth() + 1 > config.startMonth ? currentYear + 1 : currentYear
  return `${config.seasonWindow} ${year}`
}
