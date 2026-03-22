import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import JoinPublicButton from './JoinPublicButton'

const TYPE_LABELS: Record<string, string> = {
  grand_slam: 'Grand Slams',
  masters_1000: 'Masters 1000',
  '500': '500s',
  '250': '250s',
}

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

        {(publicLeagues ?? []).length === 0 ? (
          <div className="text-center py-20 bg-white rounded-sm border" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>No public leagues yet</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>Be the first to create one!</p>
            <Link href="/leagues/new" className="px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
              Create a public league
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {(publicLeagues ?? []).map((league: any) => {
              const isMember = myLeagueIds.has(league.id)
              const count = memberCounts[league.id] ?? 0
              const ownerName = league.users?.username ?? 'Unknown'
              const types = league.allowed_tournament_types as string[] | null
              return (
                <div
                  key={league.id}
                  className="flex items-center justify-between bg-white rounded-sm border px-6 py-5"
                  style={{ borderColor: 'var(--chalk-dim)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>{league.name}</span>
                    </div>
                    {league.description && (
                      <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{league.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                        by {ownerName}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                        {count} member{count !== 1 ? 's' : ''}
                      </span>
                      {types && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#1e4e8c', background: '#edf4fc', padding: '1px 6px', borderRadius: '2px' }}>
                          {types.map(t => TYPE_LABELS[t] ?? t).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 ml-4">
                    {isMember ? (
                      <Link
                        href={`/leagues/${league.id}`}
                        className="px-4 py-2 text-sm rounded-sm border"
                        style={{ borderColor: 'var(--chalk-dim)', color: 'var(--ink)', textDecoration: 'none' }}
                      >
                        View
                      </Link>
                    ) : (
                      <JoinPublicButton leagueId={league.id} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
