import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import BrowseFilters from './BrowseFilters'

export default async function BrowseLeaguesPage() {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const admin = createAdminClient()

  // Fetch public leagues visible via RLS (the updated policy includes is_public=true)
  const { data: publicLeagues } = await supabase
    .from('leagues')
    .select('id, name, description, owner_id, allowed_tournament_types, users!leagues_owner_id_fkey(username)')
    .eq('is_public', true)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  // Fetch member counts for public leagues via admin (avoids league_members RLS)
  const leagueIds = (publicLeagues ?? []).map(l => l.id)
  let memberCounts: Record<string, number> = {}
  if (leagueIds.length > 0) {
    const { data: countRows } = await admin
      .from('league_members')
      .select('league_id')
      .in('league_id', leagueIds)

    for (const row of countRows ?? []) {
      memberCounts[row.league_id] = (memberCounts[row.league_id] ?? 0) + 1
    }
  }

  // Check which leagues the user is already a member of
  const { data: myMemberships } = await supabase
    .from('league_members')
    .select('league_id')
    .eq('user_id', user.id)

  const myLeagueIds = new Set((myMemberships ?? []).map(m => m.league_id))

  // Prepare data for the client filter component
  const leagues = (publicLeagues ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    ownerName: l.users?.username ?? 'Unknown',
    memberCount: memberCounts[l.id] ?? 0,
    isMember: myLeagueIds.has(l.id),
    tournamentTypes: l.allowed_tournament_types as string[] | null,
  }))

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="leagues" />

      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/leagues" style={{ color: 'var(--muted)' }}>Leagues</Link>
          <span>/</span>
          <span>Browse</span>
        </div>

        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Public Leagues</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', lineHeight: 1.65, marginTop: '0.4rem' }}>
            Join an open league and compete with the community.
          </p>
        </div>

        {leagues.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-sm border" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>No public leagues yet</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>Be the first to create one!</p>
            <Link href="/leagues/new" className="px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
              Create a public league
            </Link>
          </div>
        ) : (
          <BrowseFilters leagues={leagues} />
        )}
      </div>
    </main>
  )
}
