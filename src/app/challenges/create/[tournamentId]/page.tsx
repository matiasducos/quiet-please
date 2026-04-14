import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import AnonymousCreateFlow from './AnonymousCreateFlow'
import { isManualLockMode } from '@/lib/app-settings'

export default async function CreateChallengeForTournamentPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>
}) {
  const { profile } = await getNavProfile().catch(() => ({ user: null, profile: null }))
  const { tournamentId } = await params
  const admin = createAdminClient()

  // Parallel fetch: tournament, draw, match results
  const [{ data: tournament }, { data: drawData }, { data: matchResults }] = await Promise.all([
    admin.from('tournaments').select('id, name, status, tour, category, surface, starts_at, ends_at, location, flag_emoji').eq('id', tournamentId).single(),
    admin.from('draws').select('bracket_data, locked_matches').eq('tournament_id', tournamentId).single(),
    admin.from('match_results').select('external_match_id, winner_external_id').eq('tournament_id', tournamentId),
  ])

  if (!tournament) notFound()
  // Challenges are always open for accepting_predictions and in_progress, regardless of prediction mode toggle
  if (!['accepting_predictions', 'in_progress'].includes(tournament.status)) {
    redirect('/challenges/create')
  }

  const draw = drawData?.bracket_data as any
  if (!draw?.matches?.length) {
    return (
      <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
        <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" />
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-10 text-center">
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>Draw not available yet</p>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>
            The draw for this tournament hasn&apos;t been published yet. Check back soon.
          </p>
          <Link href="/challenges/create" style={{ color: 'var(--court)', fontSize: '0.875rem' }}>
            ← Back to tournaments
          </Link>
        </div>
      </main>
    )
  }

  // Build match results map
  const matchResultsMap: Record<string, string> = {}
  for (const r of matchResults ?? []) {
    matchResultsMap[r.external_match_id] = r.winner_external_id
  }

  // Admin locked matches (manual_lock mode)
  const manualLock = await isManualLockMode()
  const adminLockedMatches = manualLock
    ? (drawData?.locked_matches as Record<string, string>) ?? {}
    : undefined

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/challenges" style={{ color: 'var(--muted)' }}>Challenges</Link>
          <span>/</span>
          <Link href="/challenges/create" style={{ color: 'var(--muted)' }}>Create</Link>
          <span>/</span>
          <span>{tournament.location ?? tournament.name}</span>
        </div>

        <AnonymousCreateFlow
          tournament={tournament}
          draw={draw}
          matchResults={matchResultsMap}
          adminLockedMatches={adminLockedMatches}
        />
      </div>
    </main>
  )
}
