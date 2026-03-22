import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import SettingsForm from './SettingsForm'

export default async function LeagueSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const { id } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: league } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (!league) notFound()

  // Verify user is a member (non-members can't view settings)
  const { data: myMembership } = await supabase
    .from('league_members')
    .select('league_id')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .single()

  if (!myMembership) redirect('/leagues')

  const isOwner = league.owner_id === user.id

  // Fetch members for the member management section
  const { data: members } = await admin
    .from('league_members')
    .select('user_id, total_points, joined_at, users(username)')
    .eq('league_id', id)
    .order('joined_at', { ascending: true })

  const memberList = (members ?? []).map(m => ({
    user_id: m.user_id,
    username: (m.users as any)?.username ?? 'Unknown',
    total_points: m.total_points,
    isOwner: m.user_id === league.owner_id,
  }))

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="leagues" />

      <div className="max-w-lg mx-auto px-8 py-10">
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/leagues" style={{ color: 'var(--muted)' }}>Leagues</Link>
          <span>/</span>
          <Link href={`/leagues/${id}`} style={{ color: 'var(--muted)' }}>{league.name}</Link>
          <span>/</span>
          <span>Settings</span>
        </div>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', marginBottom: '2rem' }}>
          {isOwner ? 'Edit league' : 'League settings'}
        </h1>

        <SettingsForm
          leagueId={id}
          initialName={league.name}
          initialDescription={league.description ?? ''}
          initialIsPublic={league.is_public}
          initialTournamentTypes={league.allowed_tournament_types as string[] | null}
          members={memberList}
          isOwner={isOwner}
        />
      </div>
    </main>
  )
}
