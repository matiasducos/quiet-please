import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import { getNavProfile } from '@/lib/supabase/profile'
import Nav from '@/components/Nav'
import TournamentsClientList from '@/components/TournamentsClientList'
import SeriesDirectory from '@/components/SeriesDirectory'
import { getTournamentEngagement } from '@/lib/tournaments/engagement'
import { withRecaps } from '@/lib/tournaments/recap'
import { getPredictableStatuses } from '@/lib/app-settings'
import { ON_NOW_STATUSES, compareOnNow } from '@/lib/tournaments/cached'

// Self-referencing canonical, like every indexable page — see the note in
// src/app/layout.tsx for why this cannot be inherited from the root.
export const metadata: Metadata = {
  title: 'Tournaments',
  alternates: { canonical: '/tournaments' },
}

const VALID_STATUSES = ['upcoming', 'draw_published', 'accepting_predictions', 'in_progress', 'completed'] as const

/**
 * Internal status token for the live strip. Deliberately not in VALID_STATUSES:
 * it is not a filter a visitor can ask for from the URL, it is how this page
 * asks getTournaments() for the set ON_NOW_STATUSES defines.
 */
const ON_NOW = 'on_now'

/** A resolved year filter: a specific season, or every season at once. */
type Season = number | 'all'

/**
 * Parse ?year=. Accepts a four-digit year or the literal "all"; anything else
 * (including a year with no tournaments) falls through to null and lets the
 * caller pick the default season. Deliberately *not* validated against the
 * season list here — that list is a database read, and this runs before the
 * Suspense boundary that streams it.
 */
function parseYear(raw: string | undefined): Season | null {
  if (raw === 'all') return 'all'
  if (raw && /^\d{4}$/.test(raw)) return Number(raw)
  return null
}

/**
 * Fallback for the streamed list. Carried over from the deleted
 * tournaments/loading.tsx, minus its nav skeleton — the real nav now renders
 * above this instead of being replaced by it.
 */
function TournamentsListSkeleton() {
  return (
    <>
      {/* Header + filters row */}
      <div className="flex flex-wrap items-center gap-3 mb-8">
        <div className="skeleton h-10 w-36" />
        {/* tour chips */}
        <div className="flex gap-2 ml-auto">
          <div className="skeleton h-7 w-10 rounded-full" />
          <div className="skeleton h-7 w-12 rounded-full" />
          <div className="skeleton h-7 w-12 rounded-full" />
        </div>
        {/* surface chips */}
        <div className="flex gap-2">
          <div className="skeleton h-7 w-10 rounded-full" />
          <div className="skeleton h-7 w-12 rounded-full" />
          <div className="skeleton h-7 w-14 rounded-full" />
          <div className="skeleton h-7 w-12 rounded-full" />
        </div>
      </div>

      {/* Tournament cards */}
      <div className="flex flex-col gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-white rounded-sm border px-4 md:px-6 py-4" style={{ borderColor: 'var(--chalk-dim)' }}>
            <div className="flex items-center gap-3 mb-2">
              <div className="skeleton h-5 w-10" />
              <div className="skeleton h-5 w-6" />
              <div className="skeleton h-6 w-48" />
              <div className="skeleton h-5 w-16 ml-auto" />
            </div>
            <div className="flex items-center gap-3 mt-2">
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-4 w-32" />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// Cached — same data for all users, refreshes every hour
// keyParts include tour+status so each combination gets its own cache slot
function getTournaments(tour: string, status: string, year: Season) {
  return unstable_cache(
    async () => {
      const supabase = createAdminClient()
      // The series slug rides along so completed cards can link to their recap
      // — /tournaments/<slug>/<year>/recap is the only route that resolves one.
      let q = supabase.from('tournaments').select('*, tournament_series(slug)').eq('tour', tour).order('starts_at', { ascending: true, nullsFirst: false })
      // `on_now` is an internal token, not a value the ?status= filter accepts
      // (see VALID_STATUSES) — it is how the live strip asks for its own set:
      // what is on court, plus draws that are open.
      if (status === ON_NOW) q = (q as any).in('status', ON_NOW_STATUSES)
      else if (status !== 'all') q = (q as any).eq('status', status)
      // Filtered in the database, not after the fetch: the whole point of the
      // year picker is that a visitor never pays for five dead seasons. A row
      // with a null starts_year belongs to no season and so drops out of every
      // year view — it is still reachable under "All years", which is the only
      // honest place to put it.
      if (year !== 'all') q = (q as any).eq('starts_year', year)
      const { data, error } = await q
      if (error) {
        console.error('[tournaments] list query failed:', error.message)
        return []
      }
      // The strip leads with what is being played; everywhere else keeps the
      // chronological order the calendar is grouped by.
      return status === ON_NOW ? (data ?? []).sort(compareOnNow) : (data ?? [])
    },
    ['tournament-list', tour, status, String(year)],
    { revalidate: 3600, tags: ['tournament-list'] }
  )()
}

/**
 * Seasons that have at least one tournament on this tour, newest first.
 *
 * Backed by tournament_seasons() (088) rather than a select + de-dupe in Node:
 * PostgREST has no `select distinct`, and the client-side version reads every
 * tournament row to produce six integers — then silently truncates at the
 * 1000-row cap, dropping the oldest years from the picker with no error.
 *
 * Cached for an hour on the same tag as the list, so an admin write that adds
 * the first tournament of a new season reveals that season immediately.
 */
function getSeasons(tour: string) {
  return unstable_cache(
    async () => {
      const supabase = createAdminClient()
      const { data, error } = await supabase.rpc('tournament_seasons', { p_tour: tour })
      if (error) {
        console.error('[tournaments] season query failed:', error.message)
        return []
      }
      // tournament_count comes back too. The picker showed it briefly and it
      // read as clutter, so nothing consumes it now — the column stays in 088
      // because dropping it would need a migration to buy nothing.
      return (data ?? []) as { season: number; tournament_count: number }[]
    },
    ['tournament-seasons', tour],
    { revalidate: 3600, tags: ['tournament-list'] }
  )()
}

/**
 * Cached engagement counts — refreshes every 30 minutes.
 *
 * Keyed on the filter that produced the id list, NOT on the ids themselves.
 * The old key spread every tournament id into the cache key, which made the
 * entry reusable only while the id set stayed byte-identical: one added
 * tournament, or any status change, minted a fresh entry and left the previous
 * one to expire unread. Profiled at 960ms on a miss — the single largest cost
 * on this page, and it was being paid far more often than the 30-minute
 * revalidate window suggests.
 *
 * (tour, status, year) is how getTournaments() above is keyed, so the two now
 * move together. The trade is that a tournament added mid-window shows zero counts
 * until the entry expires or an admin write revalidates the tag — these are
 * soft counts on a card, and 30 minutes of staleness was already the design.
 *
 * The tag matters: without it the only way out of a stale id set was waiting.
 * Admin writes already revalidate `tournament-list`, which is exactly when the
 * id set can change.
 */
function getEngagement(tour: string, status: string, year: Season, tournamentIds: string[]) {
  return unstable_cache(
    () => getTournamentEngagement(tournamentIds),
    ['tournament-engagement', tour, status, String(year)],
    { revalidate: 1800, tags: ['tournament-list'] }
  )()
}

/**
 * The list, split out so it can stream.
 *
 * This page is the one place in /tournaments where a Suspense boundary is safe:
 * it never calls notFound(), so there is no 404 status for a boundary to
 * swallow — see the note in src/app/layout.tsx for why that distinction runs
 * the whole app. The skeleton therefore lives here rather than in a
 * loading.tsx, which would also wrap [slug] and [year] underneath it and turn
 * every bogus tournament URL back into a 200.
 *
 * Worth splitting because the work is genuinely slow and genuinely cacheable:
 * profiled cold at 123ms for the lists, then 960ms for engagement and 454ms for
 * recaps on top. The nav above renders from getNavProfile(), which is 1-9ms for
 * a signed-out visitor, so the page frame is effectively free.
 */
async function TournamentsList({ tour, status, requestedYear, initialQuery }: { tour: string; status: string; requestedYear: Season | null; initialQuery: string }) {
  // None of these three depend on the year, so they go first and in parallel —
  // the live strip is deliberately season-agnostic (a tournament in progress is
  // in progress whatever season the visitor is browsing, and so is one whose
  // draw is open).
  const [seasons, liveTournaments, predictableStatuses] = await Promise.all([
    getSeasons(tour),
    getTournaments(tour, ON_NOW, 'all'),
    getPredictableStatuses(),
  ])

  // Resolve the year only now that the real season list is known. The default
  // is the current season; it falls back to the newest season on record so the
  // page is never blank in the gap between January 1st and the new calendar
  // being imported. A ?year= naming a season with no events lands here too,
  // which keeps the dropdown and the list showing the same thing.
  const years = seasons.map(s => s.season)
  const currentSeason = new Date().getUTCFullYear()
  const year: Season =
    requestedYear === 'all'                                  ? 'all'
    : requestedYear !== null && years.includes(requestedYear) ? requestedYear
    : years.includes(currentSeason)                           ? currentSeason
    : years[0] ?? currentSeason

  const tournaments = await getTournaments(tour, status, year)

  // Collect unique IDs for non-upcoming tournaments and fetch engagement
  const allTournaments = [...tournaments, ...liveTournaments]
  const engageableIds = [...new Set(
    allTournaments.filter(t => t.status !== 'upcoming').map(t => t.id)
  )]
  const engagement = await getEngagement(tour, status, year, engageableIds)

  // Enrich tournaments with engagement counts, then with recap stats.
  //
  // The series relation arrives embedded (and PostgREST types it as either an
  // object or an array depending on the join), so it is flattened to slug/year
  // here — that is the shape withRecaps() needs to build a recap link.
  const enrich = (list: typeof tournaments) =>
    list.map(t => {
      const embedded = t.tournament_series
      const slug = Array.isArray(embedded) ? embedded[0]?.slug ?? null : embedded?.slug ?? null
      return {
        ...t,
        slug,
        year: t.starts_year ?? null,
        prediction_count: engagement[t.id]?.predictions ?? 0,
        challenge_count: engagement[t.id]?.challenges ?? 0,
      }
    })

  // One recap lookup for both lists: the strip holds nothing completed, but
  // passing them together keeps this to a single round trip.
  const [enrichedList, enrichedLive] = await Promise.all([
    withRecaps(enrich(tournaments)),
    withRecaps(enrich(liveTournaments)),
  ])

  return (
    <TournamentsClientList
      tournaments={enrichedList}
      liveTournaments={enrichedLive}
      activeTour={tour}
      activeStatus={status}
      activeYear={year}
      seasons={years}
      currentSeason={currentSeason}
      initialQuery={initialQuery}
      predictableStatuses={predictableStatuses}
    />
  )
}

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ tour?: string; status?: string; year?: string; q?: string }> }) {
  const params       = await searchParams
  const activeTour   = params.tour === 'WTA' ? 'WTA' : 'ATP'
  const activeStatus = VALID_STATUSES.includes(params.status as any) ? params.status! : 'all'
  const activeYear   = parseYear(params.year)
  // Only ever arrives from the "search all years" link in the empty state, but
  // it is a URL and so is capped before it is echoed back into an input.
  const initialQuery = (params.q ?? '').slice(0, 80)

  const { user, profile } = await getNavProfile()

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} activePage="tournaments" userId={user?.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        {/* Keyed on the filter so switching tour or status re-suspends and shows
            the skeleton again. Without the key React keeps the previous list
            mounted while the new one loads, which reads as the filter having
            silently failed. */}
        <Suspense key={`${activeTour}:${activeStatus}:${activeYear ?? 'default'}:${initialQuery}`} fallback={<TournamentsListSkeleton />}>
          <TournamentsList tour={activeTour} status={activeStatus} requestedYear={activeYear} initialQuery={initialQuery} />
        </Suspense>

        {/* Deliberately NOT keyed on the filter: the directory is the same for
            every tour and status, and it is the only place on the site that
            links every series. Re-suspending it on a filter change would drop
            those links out of the HTML for the duration. */}
        <Suspense fallback={null}>
          <SeriesDirectory />
        </Suspense>
      </div>
    </main>
  )
}
