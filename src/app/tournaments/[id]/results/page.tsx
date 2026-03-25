import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { unstable_cache } from 'next/cache'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentMatchList from '@/components/TournamentMatchList'
import type { Metadata } from 'next'

const getTournamentResults = unstable_cache(
  async (id: string) => {
    const supabase = createAdminClient()
    const [{ data: tournament }, { data: draw }, { data: results }] = await Promise.all([
      supabase.from('tournaments').select('id, name, location, flag_emoji, tour, category, status, surface, starts_at, ends_at').eq('id', id).single(),
      supabase.from('draws').select('bracket_data').eq('tournament_id', id).single(),
      supabase.from('match_results').select('external_match_id, round, winner_external_id, loser_external_id, score').eq('tournament_id', id),
    ])
    return { tournament, draw, results: results ?? [] }
  },
  ['tournament-results'],
  { revalidate: 300, tags: ['tournament-detail'] }
)

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { tournament } = await getTournamentResults(id)
  return { title: tournament ? `Draw Results — ${tournament.name}` : 'Draw Results' }
}

export default async function TournamentResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [{ user, profile }, { tournament, draw, results }] = await Promise.all([
    getNavProfile(),
    getTournamentResults(id),
  ])

  if (!tournament) notFound()

  const bracketData = draw?.bracket_data as { rounds: string[]; matches: Array<{ matchId: string; round: string; player1: any; player2: any; scheduledAt?: string }> } | null

  if (!bracketData?.rounds || !bracketData?.matches) {
    return (
      <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
        <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="tournaments" userId={user?.id} />
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
          <Link href={`/tournaments/${id}`} style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>← Back to tournament</Link>
          <h1 className="mt-6" style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', letterSpacing: '-0.02em' }}>Draw not yet available</h1>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="tournaments" userId={user?.id} />

      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/tournaments" style={{ color: 'var(--muted)' }}>Tournaments</Link>
          <span>/</span>
          <Link href={`/tournaments/${id}`} style={{ color: 'var(--muted)' }}>
            {tournament.flag_emoji && <span style={{ marginRight: '4px' }}>{tournament.flag_emoji}</span>}
            {tournament.location ?? tournament.name}
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--ink)' }}>Results</span>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.5rem, 4vw, 2rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {tournament.flag_emoji && <span style={{ marginRight: '8px' }}>{tournament.flag_emoji}</span>}
            Draw Results
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--muted)', marginTop: '4px' }}>
            {tournament.name}
          </p>
        </div>

        {/* Match list */}
        <TournamentMatchList
          rounds={bracketData.rounds}
          matches={bracketData.matches}
          matchResults={results}
          mode="results"
        />

        <div className="mt-8">
          <Link href={`/tournaments/${id}`} style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>← Back to tournament</Link>
        </div>
      </div>
    </main>
  )
}
