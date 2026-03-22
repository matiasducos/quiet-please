import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { respondToChallenge } from './actions'
import CancelButton from '../CancelButton'

export default async function ChallengeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const { id } = await params
  const admin = createAdminClient()

  const { data: challenge } = await admin
    .from('challenges')
    .select('id, challenger_id, challenged_id, tournament_id, status, challenger_points, challenged_points, challenger_predictions_count, challenged_predictions_count, winner_id, created_at')
    .eq('id', id)
    .single()

  if (!challenge) notFound()

  const isChallenger = challenge.challenger_id === user.id
  const isChallenged = challenge.challenged_id === user.id
  if (!isChallenger && !isChallenged) redirect('/challenges')

  // Fetch both player profiles + tournament
  const [{ data: challengerProfile }, { data: challengedProfile }, { data: tournament }] = await Promise.all([
    admin.from('users').select('id, username').eq('id', challenge.challenger_id).single(),
    admin.from('users').select('id, username').eq('id', challenge.challenged_id).single(),
    admin.from('tournaments').select('id, name, status, starts_at, ends_at, tour, surface, location, flag_emoji').eq('id', challenge.tournament_id).single(),
  ])

  const myUsername   = isChallenger ? challengerProfile?.username : challengedProfile?.username
  const theirUsername = isChallenger ? challengedProfile?.username : challengerProfile?.username
  const theirId      = isChallenger ? challenge.challenged_id : challenge.challenger_id

  const myPoints    = isChallenger ? challenge.challenger_points : challenge.challenged_points
  const theirPoints = isChallenger ? challenge.challenged_points : challenge.challenger_points
  const myPredCount = isChallenger ? challenge.challenger_predictions_count : challenge.challenged_predictions_count
  const theirPredCount = isChallenger ? challenge.challenged_predictions_count : challenge.challenger_predictions_count

  const isDraw    = challenge.status === 'completed' && challenge.winner_id === null
  const isWinner  = challenge.winner_id === user.id
  const isLoser   = challenge.status === 'completed' && challenge.winner_id !== null && !isWinner

  // Check challenge-specific predictions for lock status + pick counts
  let myPicksLocked    = false
  let theirPicksLocked = false
  let myPickCount      = 0
  let theirPickCount   = 0

  if (['accepted', 'completed'].includes(challenge.status)) {
    const { data: preds } = await admin
      .from('predictions')
      .select('user_id, is_fully_locked, picks')
      .eq('challenge_id', challenge.id)
      .eq('tournament_id', challenge.tournament_id)

    const myPred    = (preds ?? []).find(p => p.user_id === user.id)
    const theirPred = (preds ?? []).find(p => p.user_id === theirId)

    myPicksLocked    = myPred?.is_fully_locked === true
    theirPicksLocked = theirPred?.is_fully_locked === true
    myPickCount      = Object.keys((myPred?.picks as Record<string, string> | null) ?? {}).length
    theirPickCount   = Object.keys((theirPred?.picks as Record<string, string> | null) ?? {}).length
  }

  // Pending challenges only auto-expire for completed tournaments (not in_progress)
  const effectiveStatus =
    challenge.status === 'pending' && tournament?.status === 'completed'
      ? 'expired'
      : challenge.status

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" userId={user.id} />

      <div className="max-w-2xl mx-auto px-4 md:px-8 py-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/challenges" style={{ color: 'var(--muted)' }}>Challenges</Link>
          <span>/</span>
          <span>{myUsername} vs {theirUsername}</span>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {myUsername} <span style={{ color: 'var(--muted)' }}>vs</span> {theirUsername}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            {tournament?.location ?? tournament?.name} · {tournament?.tour} · {tournament?.starts_at ? formatDate(tournament.starts_at) : ''}
          </p>
        </div>

        {/* ── Pending: needs response ─────────────────────────────────────── */}
        {effectiveStatus === 'pending' && isChallenged && (
          <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>
              {challengerProfile?.username} is challenging you!
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>
              Accept to predict {tournament?.name} head-to-head. Picks are revealed as matches are played, or when both of you lock your full bracket.
            </p>
            <div className="flex gap-3">
              <form action={respondToChallenge}>
                <input type="hidden" name="challenge_id" value={challenge.id} />
                <input type="hidden" name="response" value="accepted" />
                <button
                  type="submit"
                  className="px-5 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
                  style={{ background: 'var(--court)' }}
                >
                  Accept challenge
                </button>
              </form>
              <form action={respondToChallenge}>
                <input type="hidden" name="challenge_id" value={challenge.id} />
                <input type="hidden" name="response" value="declined" />
                <button
                  type="submit"
                  className="px-5 py-2.5 text-sm rounded-sm border"
                  style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white' }}
                >
                  Decline
                </button>
              </form>
            </div>
          </div>
        )}

        {effectiveStatus === 'pending' && isChallenger && (
          <div className="bg-white rounded-sm border p-6 mb-6 text-center" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1rem' }}>
              Waiting for <strong>{theirUsername}</strong> to accept your challenge.
            </p>
            <CancelButton challengeId={challenge.id} />
          </div>
        )}

        {/* ── Expired ─────────────────────────────────────────────────────── */}
        {effectiveStatus === 'expired' && (
          <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.25rem' }}>Challenge expired</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              {tournament?.name} has completed. Challenges must be accepted before the tournament ends.
            </p>
          </div>
        )}

        {/* ── Cancelled ───────────────────────────────────────────────────── */}
        {effectiveStatus === 'cancelled' && (
          <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.25rem' }}>Challenge cancelled</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              {isChallenger
                ? 'You cancelled this challenge.'
                : `${challengerProfile?.username} cancelled this challenge.`}
            </p>
          </div>
        )}

        {/* ── Declined ────────────────────────────────────────────────────── */}
        {effectiveStatus === 'declined' && (
          <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.25rem' }}>Challenge not accepted</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              {isChallenger
                ? `${theirUsername} declined your challenge. Better luck next time!`
                : 'You declined this challenge.'}
            </p>
          </div>
        )}

        {/* ── Active (accepted) ────────────────────────────────────────────── */}
        {effectiveStatus === 'accepted' && (
          <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '1rem' }}>Challenge active</p>
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center justify-between">
                <span style={{ fontSize: '0.875rem', color: 'var(--ink)' }}>{myUsername} (you)</span>
                <div className="flex items-center gap-2">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                    {myPickCount} picks
                  </span>
                  {myPicksLocked
                    ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', letterSpacing: '0.05em' }}>LOCKED ✓</span>
                    : <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#c17c00' }}>IN PROGRESS</span>}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: '0.875rem', color: 'var(--ink)' }}>{theirUsername}</span>
                <div className="flex items-center gap-2">
                  {/* Only show opponent's pick count if both locked (poker rule) */}
                  {myPicksLocked && theirPicksLocked && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                      {theirPickCount} picks
                    </span>
                  )}
                  {theirPicksLocked
                    ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', letterSpacing: '0.05em' }}>LOCKED ✓</span>
                    : <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>IN PROGRESS</span>}
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <Link
                href={`/tournaments/${challenge.tournament_id}/predict?challenge=${challenge.id}`}
                className="inline-block px-5 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
                style={{ background: 'var(--court)', textDecoration: 'none' }}
              >
                {myPicksLocked ? 'Review your picks →' : myPickCount > 0 ? 'Edit your picks →' : 'Make your picks →'}
              </Link>
              {myPicksLocked && theirPicksLocked && (
                <Link
                  href={`/tournaments/${challenge.tournament_id}/picks/${theirUsername}?challenge=${challenge.id}`}
                  className="inline-block px-5 py-2.5 text-sm rounded-sm border hover:bg-white transition-colors"
                  style={{ borderColor: 'var(--chalk-dim)', color: 'var(--ink)', textDecoration: 'none' }}
                >
                  View {theirUsername}&apos;s picks →
                </Link>
              )}
            </div>
          </div>
        )}

        {/* ── Completed ───────────────────────────────────────────────────── */}
        {effectiveStatus === 'completed' && (
          <>
            {/* Result banner */}
            <div
              className="rounded-sm border p-6 mb-6 text-center"
              style={{
                borderColor: isDraw ? 'var(--chalk-dim)' : isWinner ? '#97C459' : '#f4c5ba',
                background: isDraw ? 'var(--chalk)' : isWinner ? '#eaf3de' : '#fdf1ee',
              }}
            >
              <p style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.75rem',
                letterSpacing: '-0.02em',
                color: isDraw ? 'var(--ink)' : isWinner ? '#27500A' : '#c84b31',
                marginBottom: '0.25rem',
              }}>
                {isDraw ? 'Draw' : isWinner ? 'You win!' : `${theirUsername} wins`}
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', color: 'var(--muted)' }}>
                {myPoints ?? 0} pts <span style={{ color: 'var(--muted)' }}>vs</span> {theirPoints ?? 0} pts
              </p>
              {isDraw && myPredCount != null && (
                <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                  {myPredCount} vs {theirPredCount} predictions made
                </p>
              )}
            </div>

            {/* View brackets — challenge-specific predict page */}
            <div className="flex gap-3">
              <Link
                href={`/tournaments/${challenge.tournament_id}/predict?challenge=${challenge.id}`}
                className="flex-1 px-4 py-3 text-sm text-center rounded-sm border"
                style={{ borderColor: 'var(--chalk-dim)', color: 'var(--ink)', textDecoration: 'none', background: 'white' }}
              >
                View challenge picks →
              </Link>
            </div>
          </>
        )}

        {/* Tournament link */}
        <div className="mt-6 text-center">
          <Link
            href={`/tournaments/${challenge.tournament_id}`}
            style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
          >
            View tournament →
          </Link>
        </div>
      </div>
    </main>
  )
}
