import { createClient } from '@/lib/supabase/server'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

export default async function LeaguesPage() {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: memberships } = await supabase
    .from('league_members')
    .select('league_id, total_points, joined_at, leagues(id, name, description, invite_code, owner_id, is_active)')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false })

  // Fetch all members to compute rank per league
  const leagueIds = (memberships ?? []).map(m => m.league_id)
  const { data: allMembers } = leagueIds.length > 0
    ? await supabase.from('league_members').select('league_id, user_id, total_points').in('league_id', leagueIds).order('total_points', { ascending: false })
    : { data: [] as any[] }

  const leagueStats: Record<string, { rank: number; count: number }> = {}
  for (const lid of leagueIds) {
    const members = (allMembers ?? []).filter((m: any) => m.league_id === lid)
    const rank = members.findIndex((m: any) => m.user_id === user.id) + 1
    leagueStats[lid] = { rank: rank || 1, count: members.length }
  }

  const leagues = (memberships ?? []).map(m => ({
    ...(m.leagues as any),
    my_points: m.total_points,
    my_rank: leagueStats[m.league_id]?.rank ?? 1,
    member_count: leagueStats[m.league_id]?.count ?? 1,
  }))

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="leagues" userId={user.id} />

      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Leagues</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', lineHeight: 1.65, marginTop: '0.4rem' }}>Create a private league with friends and track who makes the sharpest calls across the full season. Your picks in any tournament you enter count toward the league standings.</p>
          <div className="flex gap-3 mt-4">
            <Link
              href="/leagues/join"
              className="px-4 py-2 text-sm rounded-sm border transition-colors whitespace-nowrap"
              style={{ background: 'white', borderColor: 'var(--chalk-dim)', color: 'var(--ink)', textDecoration: 'none' }}
            >
              Join with code
            </Link>
            <Link
              href="/leagues/new"
              className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90 whitespace-nowrap"
              style={{ background: 'var(--court)', textDecoration: 'none' }}
            >
              Create league
            </Link>
          </div>
        </div>

        {leagues.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-sm border" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>No leagues yet</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>Create one or join with an invite code.</p>
            <Link href="/leagues/new" className="px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
              Create your first league
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {leagues.map((league: any) => (
              <Link
                key={league.id}
                href={`/leagues/${league.id}`}
                className="flex items-center justify-between bg-white rounded-sm border px-6 py-5 tournament-card"
                style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>{league.name}</span>
                    {league.owner_id === user.id && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--court)', background: '#eaf3de', padding: '1px 6px', borderRadius: '2px' }}>owner</span>
                    )}
                  </div>
                  {league.description && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{league.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--ink)' }}>{league.my_points} pts</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', minWidth: '40px', textAlign: 'right' }}>
                    #{league.my_rank}<span style={{ fontSize: '0.6rem', marginLeft: '2px' }}>/{league.member_count}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
