import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import Nav from '@/components/Nav'
import TournamentsClientList from '@/components/TournamentsClientList'

// Cached — same data for all users, refreshes every hour
const getTournaments = unstable_cache(
  async (tour: string, surface: string) => {
    const supabase = createAdminClient()
    let q = supabase.from('tournaments').select('*').eq('tour', tour).order('starts_at', { ascending: true, nullsFirst: false })
    if (surface !== 'all') q = (q as any).eq('surface', surface)
    const { data } = await q
    return data ?? []
  },
  ['tournament-list'],
  { revalidate: 3600 }
)

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ tour?: string; surface?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const params        = await searchParams
  const activeTour    = params.tour === 'WTA' ? 'WTA' : 'ATP'
  const activeSurface = ['clay', 'grass', 'hard'].includes(params.surface ?? '') ? params.surface! : 'all'

  const [tournaments, profile] = await Promise.all([
    getTournaments(activeTour, activeSurface),
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
          activeSurface={activeSurface}
        />
      </div>
    </main>
  )
}
