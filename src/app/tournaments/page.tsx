import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import { getNavProfile } from '@/lib/supabase/profile'
import Nav from '@/components/Nav'
import TournamentsClientList from '@/components/TournamentsClientList'
import { getTournamentEngagement } from '@/lib/tournaments/engagement'

const VALID_STATUSES = ['upcoming', 'draw_published', 'accepting_predictions', 'in_progress', 'completed'] as const

// Cached — same data for all users, refreshes every hour
// keyParts include tour+status so each combination gets its own cache slot
function getTournaments(tour: string, status: string) {
  return unstable_cache(
    async () => {
      const supabase = createAdminClient()
      let q = supabase.from('tournaments').select('*').eq('tour', tour).order('starts_at', { ascending: true, nullsFirst: false })
      if (status !== 'all') q = (q as any).eq('status', status)
      const { data } = await q
      return data ?? []
    },
    ['tournament-list', tour, status],
    { revalidate: 3600, tags: ['tournament-list'] }
  )()
}

// Cached engagement counts — refreshes every 30 minutes
function getEngagement(tournamentIds: string[]) {
  return unstable_cache(
    () => getTournamentEngagement(tournamentIds),
    ['tournament-engagement', ...tournamentIds.sort()],
    { revalidate: 1800 }
  )()
}

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ tour?: string; status?: string }> }) {
  const params       = await searchParams
  const activeTour   = params.tour === 'WTA' ? 'WTA' : 'ATP'
  const activeStatus = VALID_STATUSES.includes(params.status as any) ? params.status! : 'all'

  const [{ user, profile }, tournaments, liveTournaments] = await Promise.all([
    getNavProfile(),
    getTournaments(activeTour, activeStatus),
    getTournaments(activeTour, 'in_progress'),
  ])

  // Collect unique IDs for non-upcoming tournaments and fetch engagement
  const allTournaments = [...tournaments, ...liveTournaments]
  const engageableIds = [...new Set(
    allTournaments.filter(t => t.status !== 'upcoming').map(t => t.id)
  )]
  const engagement = await getEngagement(engageableIds)

  // Enrich tournaments with engagement counts
  const enrich = (list: typeof tournaments) =>
    list.map(t => ({
      ...t,
      prediction_count: engagement[t.id]?.predictions ?? 0,
      challenge_count: engagement[t.id]?.challenges ?? 0,
    }))

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="tournaments" userId={user?.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <TournamentsClientList
          tournaments={enrich(tournaments)}
          liveTournaments={enrich(liveTournaments)}
          activeTour={activeTour}
          activeStatus={activeStatus}
        />
      </div>
    </main>
  )
}
