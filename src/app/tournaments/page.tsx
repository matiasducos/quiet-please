import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import Nav from '@/components/Nav'
import TournamentsClientList from '@/components/TournamentsClientList'

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
    { revalidate: 3600 }
  )()
}

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ tour?: string; status?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const params       = await searchParams
  const activeTour   = params.tour === 'WTA' ? 'WTA' : 'ATP'
  const activeStatus = VALID_STATUSES.includes(params.status as any) ? params.status! : 'all'

  const [tournaments, profile] = await Promise.all([
    getTournaments(activeTour, activeStatus),
    user
      ? supabase.from('users').select('username, ranking_points').eq('id', user.id).single().then(r => r.data)
      : Promise.resolve(null),
  ])

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="tournaments" userId={user?.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <TournamentsClientList
          tournaments={tournaments}
          activeTour={activeTour}
          activeStatus={activeStatus}
        />
      </div>
    </main>
  )
}
