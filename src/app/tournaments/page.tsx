import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import { getNavProfile } from '@/lib/supabase/profile'
import Nav from '@/components/Nav'
import TournamentsClientList from '@/components/TournamentsClientList'
import { getTournamentEngagement } from '@/lib/tournaments/engagement'
import { withRecaps } from '@/lib/tournaments/recap'
import { getPredictableStatuses } from '@/lib/app-settings'

// Self-referencing canonical, like every indexable page — see the note in
// src/app/layout.tsx for why this cannot be inherited from the root.
export const metadata: Metadata = {
  title: 'Tournaments',
  alternates: { canonical: '/tournaments' },
}

const VALID_STATUSES = ['upcoming', 'draw_published', 'accepting_predictions', 'in_progress', 'completed'] as const

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
function getTournaments(tour: string, status: string) {
  return unstable_cache(
    async () => {
      const supabase = createAdminClient()
      // The series slug rides along so completed cards can link to their recap
      // — /tournaments/<slug>/<year>/recap is the only route that resolves one.
      let q = supabase.from('tournaments').select('*, tournament_series(slug)').eq('tour', tour).order('starts_at', { ascending: true, nullsFirst: false })
      if (status !== 'all') q = (q as any).eq('status', status)
      const { data, error } = await q
      if (error) {
        console.error('[tournaments] list query failed:', error.message)
        return []
      }
      return data ?? []
    },
    ['tournament-list', tour, status],
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
 * (tour, status) is how getTournaments() above is keyed, so the two now move
 * together. The trade is that a tournament added mid-window shows zero counts
 * until the entry expires or an admin write revalidates the tag — these are
 * soft counts on a card, and 30 minutes of staleness was already the design.
 *
 * The tag matters: without it the only way out of a stale id set was waiting.
 * Admin writes already revalidate `tournament-list`, which is exactly when the
 * id set can change.
 */
function getEngagement(tour: string, status: string, tournamentIds: string[]) {
  return unstable_cache(
    () => getTournamentEngagement(tournamentIds),
    ['tournament-engagement', tour, status],
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
async function TournamentsList({ tour, status }: { tour: string; status: string }) {
  const [tournaments, liveTournaments, predictableStatuses] = await Promise.all([
    getTournaments(tour, status),
    getTournaments(tour, 'in_progress'),
    getPredictableStatuses(),
  ])

  // Collect unique IDs for non-upcoming tournaments and fetch engagement
  const allTournaments = [...tournaments, ...liveTournaments]
  const engageableIds = [...new Set(
    allTournaments.filter(t => t.status !== 'upcoming').map(t => t.id)
  )]
  const engagement = await getEngagement(tour, status, engageableIds)

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

  // One recap lookup for both lists: the live list holds nothing completed, but
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
      predictableStatuses={predictableStatuses}
    />
  )
}

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ tour?: string; status?: string }> }) {
  const params       = await searchParams
  const activeTour   = params.tour === 'WTA' ? 'WTA' : 'ATP'
  const activeStatus = VALID_STATUSES.includes(params.status as any) ? params.status! : 'all'

  const { user, profile } = await getNavProfile()

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} activePage="tournaments" userId={user?.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        {/* Keyed on the filter so switching tour or status re-suspends and shows
            the skeleton again. Without the key React keeps the previous list
            mounted while the new one loads, which reads as the filter having
            silently failed. */}
        <Suspense key={`${activeTour}:${activeStatus}`} fallback={<TournamentsListSkeleton />}>
          <TournamentsList tour={activeTour} status={activeStatus} />
        </Suspense>
      </div>
    </main>
  )
}
