import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import BracketPredictor from './BracketPredictor'
import { TEST_EXTERNAL_ID } from '@/app/test-tournaments/constants'
import { getTournamentISOWeeks } from '@/lib/utils/iso-week'
import { canPredictForStatus } from '@/lib/app-settings'

export default async function PredictPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ challenge?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { id } = await params
  const { challenge: challengeId } = await searchParams

  // ── Parallel fetch: tournament, draw, prediction, profile, results ─────
  let predictionQuery = supabase
    .from('predictions')
    .select('id, picks, pick_locks, is_fully_locked, points_earned, challenge_id')
    .eq('tournament_id', id)
    .eq('user_id', user.id)

  if (challengeId) {
    predictionQuery = predictionQuery.eq('challenge_id', challengeId)
  } else {
    predictionQuery = predictionQuery.is('challenge_id', null)
  }

  const [
    { data: tournament },
    { data: draw },
    { data: prediction },
    { data: profile },
    { data: resultsData },
    challengeRes,
  ] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', id).single(),
    supabase.from('draws').select('bracket_data').eq('tournament_id', id).single(),
    predictionQuery.single(),
    supabase.from('users').select('username').eq('id', user.id).single(),
    supabase.from('match_results').select('external_match_id, winner_external_id').eq('tournament_id', id),
    challengeId
      ? supabase.from('challenges').select('challenger_id, challenged_id').eq('id', challengeId).single()
      : Promise.resolve({ data: null as any }),
  ])

  if (!tournament) notFound()

  const isTest = tournament.external_id === TEST_EXTERNAL_ID
  const isManual = tournament.is_manual === true
  const returnUrl = isTest ? '/test-tournaments' : `/tournaments/${id}`

  const canPredictNow = await canPredictForStatus(tournament.status)
  if (!canPredictNow) {
    redirect(returnUrl)
  }

  if (!draw?.bracket_data) redirect(`/tournaments/${id}`)

  // ── Match results + points (points need prediction.id) ─────────────────
  const matchResults: Record<string, string> = Object.fromEntries(
    (resultsData ?? []).map((r: any) => [r.external_match_id, r.winner_external_id])
  )
  let matchPoints: Record<string, { points: number; streakMultiplier: number }> = {}

  if (prediction) {
    const { data: pointsData } = await supabase
      .from('point_ledger')
      .select('points, streak_multiplier, match_results(external_match_id)')
      .eq('prediction_id', prediction.id)

    matchPoints = Object.fromEntries(
      (pointsData ?? [])
        .filter((r: any) => r.match_results?.external_match_id)
        .map((r: any) => [
          r.match_results.external_match_id,
          { points: r.points, streakMultiplier: r.streak_multiplier ?? 1 },
        ])
    )
  }

  // ── Slot pre-check — single batch query instead of N+1 loop ───────────
  if (!prediction && !challengeId && !isTest && !isManual) {
    const weeks = getTournamentISOWeeks(tournament.starts_at, tournament.ends_at)
    const allWeekNums = weeks.map(w => w.week)
    const allYears = [...new Set(weeks.map(w => w.year))]

    const { data: conflicts } = await supabase
      .from('weekly_slots')
      .select('tournament_id, iso_week, tournaments(id, name)')
      .eq('user_id', user.id)
      .eq('circuit', tournament.tour)
      .in('iso_year', allYears)
      .in('iso_week', allWeekNums)
      .neq('tournament_id', id)
      .limit(1)

    const conflict = conflicts?.[0]
    if (conflict) {
      const conflictT = conflict.tournaments as any
      return (
        <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
          <nav className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
            <div className="max-w-5xl mx-auto flex items-center px-4 md:px-6 py-4">
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

  // ── Challenge context (opponent lookup, already fetched challenge above) ─
  let challengeContext: { opponentUsername: string; challengeId: string } | undefined
  if (challengeId && challengeRes.data) {
    const challenge = challengeRes.data
    const opponentId = challenge.challenger_id === user.id
      ? challenge.challenged_id
      : challenge.challenger_id
    const { data: opponentProfile } = await supabase
      .from('users')
      .select('username')
      .eq('id', opponentId)
      .single()
    challengeContext = {
      opponentUsername: opponentProfile?.username ?? 'Opponent',
      challengeId,
    }
  }

  // ── Fully locked → show read-only bracket with results overlay ─────────
  const isFullyLocked = prediction?.is_fully_locked === true

  return (
    <BracketPredictor
      tournament={tournament}
      draw={draw.bracket_data as any}
      existingPicks={(prediction?.picks as Record<string, string>) ?? {}}
      predictionId={prediction?.id ?? null}
      username={profile?.username ?? ''}
      returnUrl={challengeId ? `/challenges/${challengeId}` : returnUrl}
      matchResults={matchResults}
      matchPoints={matchPoints}
      pickLocks={(prediction?.pick_locks as Record<string, string>) ?? {}}
      isFullyLocked={isFullyLocked}
      challengeContext={challengeContext}
      shareUrl={!challengeId && profile?.username ? `/tournaments/${id}/picks/${profile.username}` : undefined}
    />
  )
}
