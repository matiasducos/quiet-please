import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import BracketPredictor from './BracketPredictor'
import { TEST_EXTERNAL_ID } from '@/app/test-tournaments/constants'
import { getTournamentISOWeeks } from '@/lib/utils/iso-week'

export default async function PredictPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { id } = await params

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', id)
    .single()

  if (!tournament) notFound()

  const isPractice = tournament.status === 'completed'
  const isTest = tournament.external_id === TEST_EXTERNAL_ID
  const isManual = tournament.is_manual === true
  const returnUrl = isTest ? '/test-tournaments' : `/tournaments/${id}`

  // Only allow predict page for accepting_predictions (real) and completed (practice)
  if (tournament.status !== 'accepting_predictions' && !isPractice) {
    redirect(returnUrl)
  }

  const { data: draw } = await supabase
    .from('draws')
    .select('bracket_data')
    .eq('tournament_id', id)
    .single()

  if (!draw?.bracket_data) redirect(`/tournaments/${id}`)

  const { data: prediction } = await supabase
    .from('predictions')
    .select('id, picks, is_locked')
    .eq('tournament_id', id)
    .eq('user_id', user.id)
    .single()

  const { data: profile } = await supabase
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single()

  // Fetch match results for: practice mode, locked picks (readOnly), and in_progress tournaments
  const needsResults = isPractice || prediction?.is_locked ||
    tournament.status === 'in_progress' || tournament.status === 'completed'

  let matchResults: Record<string, string> = {}
  let matchPoints: Record<string, number> = {}
  if (needsResults) {
    const [resultsRes, pointsRes] = await Promise.all([
      supabase
        .from('match_results')
        .select('external_match_id, winner_external_id')
        .eq('tournament_id', id),
      prediction?.is_locked
        ? supabase
            .from('point_ledger')
            .select('points, match_results(external_match_id)')
            .eq('user_id', user.id)
            .eq('tournament_id', id)
        : Promise.resolve({ data: null as any }),
    ])
    matchResults = Object.fromEntries(
      (resultsRes.data ?? []).map((r: any) => [r.external_match_id, r.winner_external_id])
    )
    if (pointsRes.data) {
      matchPoints = Object.fromEntries(
        (pointsRes.data ?? [])
          .filter((r: any) => r.match_results?.external_match_id)
          .map((r: any) => [r.match_results.external_match_id, r.points])
      )
    }
  }

  // ── Slot pre-check: show a "slot taken" screen rather than the full bracket
  // when this user already has a slot for the same circuit this week.
  // Only runs when there is no existing prediction (first visit) and it's not practice mode.
  if (!prediction && !isPractice && !isTest && !isManual) {
    const weeks = getTournamentISOWeeks(tournament.starts_at, tournament.ends_at)
    for (const w of weeks) {
      const { data: conflict } = await supabase
        .from('weekly_slots')
        .select('tournament_id, tournaments(id, name)')
        .eq('user_id', user.id)
        .eq('circuit', tournament.tour)
        .eq('iso_year', w.year)
        .eq('iso_week', w.week)
        .neq('tournament_id', id)
        .maybeSingle()

      if (conflict) {
        const conflictT = conflict.tournaments as any
        return (
          <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
            <nav className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="flex items-center px-4 md:px-6 py-4">
                <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
                  Quiet Please
                </Link>
              </div>
            </nav>
            <div className="max-w-lg mx-auto px-6 py-20 text-center">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '1rem' }}>
                Slot taken
              </p>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', marginBottom: '1rem' }}>
                {tournament.tour} slot unavailable
              </h1>
              <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.7, maxWidth: '380px', margin: '0 auto' }}>
                Your {tournament.tour} slot this week is already taken by{' '}
                <strong style={{ color: 'var(--ink)' }}>{conflictT?.name ?? 'another tournament'}</strong>.{' '}
                You can only enter one {tournament.tour} tournament per ISO week.
              </p>
              <div className="flex flex-col items-center gap-3 mt-10">
                {conflictT?.id && (
                  <Link
                    href={`/tournaments/${conflictT.id}/predict`}
                    className="px-6 py-3 text-sm font-medium text-white rounded-sm"
                    style={{ background: 'var(--court)' }}
                  >
                    View picks for {conflictT.name} →
                  </Link>
                )}
                <Link href={returnUrl} style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                  ← Back to tournament
                </Link>
              </div>
            </div>
          </main>
        )
      }
    }
  }

  // ── Locked picks → show readOnly bracket with results overlay
  if (prediction?.is_locked) {
    return (
      <BracketPredictor
        tournament={tournament}
        draw={draw.bracket_data as any}
        existingPicks={(prediction.picks as Record<string, string>) ?? {}}
        predictionId={prediction.id}
        username={profile?.username ?? ''}
        returnUrl={returnUrl}
        matchResults={matchResults}
        matchPoints={matchPoints}
        readOnly
        shareUrl={profile?.username ? `/tournaments/${id}/picks/${profile.username}` : undefined}
      />
    )
  }

  return (
    <BracketPredictor
      tournament={tournament}
      draw={draw.bracket_data as any}
      existingPicks={(prediction?.picks as Record<string, string>) ?? {}}
      predictionId={prediction?.id ?? null}
      username={profile?.username ?? ''}
      returnUrl={returnUrl}
      isPractice={isPractice}
      matchResults={matchResults}
    />
  )
}
