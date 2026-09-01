import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect, notFound } from 'next/navigation'
import { gateRedirect } from '@/lib/auth-redirect'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { formatPoints } from '@/lib/utils/format'
import { respondToChallenge as _respondToChallenge } from './actions'

// Wrap to satisfy React's form action type (void | Promise<void>)
const respondToChallenge = async (formData: FormData) => { 'use server'; await _respondToChallenge(formData) }
import CancelButton from '../CancelButton'
import SendChallengeButton from './SendChallengeButton'
import ChallengePicksTabs from './ChallengePicksTabs'
import ChallengeScoreboard from './ChallengeScoreboard'
import { matchIdsInScope, roundsInScope, scopeLabel } from '@/lib/challenges/scope'
import type { Draw } from '@/lib/tennis/types'

/**
 * A challenge is a private bracket contest between friends, addressed by UUID.
 * Nobody searches for one, and the page is a 200 for anyone with the link — so
 * it is noindex rather than left to chance.
 *
 * noindex here, NOT `Disallow: /challenges/` in robots.txt: that pattern would
 * also block /challenges/create, which is listed in the sitemap, and a
 * sitemapped URL blocked by robots is its own Search Console defect.
 *
 * This route is also still a soft 404 for a bogus id — it has its own
 * loading.tsx, and any Suspense boundary above a page swallows notFound()'s
 * status (see src/app/layout.tsx). Deliberately left: the skeleton is worth
 * more on a signed-in surface than the status code, and noindex removes the
 * only consequence that mattered.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
}

export default async function ChallengeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { user, profile } = await getNavProfile()

  const { id } = await params
  // Someone landing here is usually following a challenge link from a friend,
  // so they are more likely to need an account than to have one — and
  // arriving on a bare "Welcome back" with no mention of the challenge was
  // the worst version of this.
  if (!user) redirect(gateRedirect(`/challenges/${id}`, 'new'))
  const admin = createAdminClient()

  const { data: challenge } = await admin
    .from('challenges')
    .select('id, challenger_id, challenged_id, tournament_id, status, scope_round, challenger_points, challenged_points, challenger_predictions_count, challenged_predictions_count, winner_id, created_at')
    .eq('id', id)
    .single()

  if (!challenge) notFound()

  const isChallenger = challenge.challenger_id === user.id
  const isChallenged = challenge.challenged_id === user.id
  if (!isChallenger && !isChallenged) redirect('/challenges')

  // A draft belongs to the challenger alone — it exists, but the other side has
  // not been told about it and must not be able to read it from a guessed URL.
  if (challenge.status === 'draft' && !isChallenger) notFound()

  // Fetch both player profiles + tournament
  const [{ data: challengerProfile }, { data: challengedProfile }, { data: tournament }] = await Promise.all([
    admin.from('users').select('id, username').eq('id', challenge.challenger_id).single(),
    admin.from('users').select('id, username').eq('id', challenge.challenged_id).single(),
    admin.from('tournaments').select('id, name, status, starts_at, ends_at, tour, surface, category, location, flag_emoji').eq('id', challenge.tournament_id).single(),
  ])

  const myUsername    = isChallenger ? challengerProfile?.username : challengedProfile?.username
  const theirUsername = isChallenger ? challengedProfile?.username : challengerProfile?.username
  const theirId       = isChallenger ? challenge.challenged_id : challenge.challenger_id

  const myPoints    = isChallenger ? challenge.challenger_points : challenge.challenged_points
  const theirPoints = isChallenger ? challenge.challenged_points : challenge.challenger_points
  const myPredCount = isChallenger ? challenge.challenger_predictions_count : challenge.challenged_predictions_count
  const theirPredCount = isChallenger ? challenge.challenged_predictions_count : challenge.challenger_predictions_count

  const isDraw    = challenge.status === 'completed' && challenge.winner_id === null
  const isWinner  = challenge.winner_id === user.id

  // ── Both brackets ────────────────────────────────────────────────────────
  let myPicks: Record<string, string> = {}
  let theirPicks: Record<string, string> = {}
  let myLivePoints    = 0
  let theirLivePoints = 0
  let myPredId: string | null = null
  let theirPredId: string | null = null

  if (['draft', 'pending', 'accepted', 'completed'].includes(challenge.status)) {
    const { data: preds, error: predsErr } = await admin
      .from('predictions')
      .select('id, user_id, picks, points_earned')
      .eq('challenge_id', challenge.id)
      .eq('tournament_id', challenge.tournament_id)

    if (predsErr) console.error('[challenge] predictions read failed', predsErr)

    const myPred    = (preds ?? []).find(p => p.user_id === user.id)
    const theirPred = (preds ?? []).find(p => p.user_id === theirId)

    myPicks         = (myPred?.picks as Record<string, string> | null) ?? {}
    theirPicks      = (theirPred?.picks as Record<string, string> | null) ?? {}
    myLivePoints    = myPred?.points_earned ?? 0
    theirLivePoints = theirPred?.points_earned ?? 0
    myPredId        = myPred?.id ?? null
    theirPredId     = theirPred?.id ?? null
  }

  // ── Draw, results and per-match points ───────────────────────────────────
  //
  // Fetched unconditionally rather than behind a reveal gate. There is no
  // longer a state in which this page shows nothing: your own bracket is always
  // yours to look at, and the opponent's is revealed match by match rather than
  // all at once (below).
  const [{ data: drawRow }, { data: resultsData }, { data: myPointsData }, { data: theirPointsData }] = await Promise.all([
    admin.from('draws').select('bracket_data').eq('tournament_id', challenge.tournament_id).maybeSingle(),
    admin.from('match_results').select('external_match_id, winner_external_id').eq('tournament_id', challenge.tournament_id),
    myPredId ? admin.from('point_ledger').select('points, streak_multiplier, match_results(external_match_id)').eq('prediction_id', myPredId) : Promise.resolve({ data: null }),
    theirPredId ? admin.from('point_ledger').select('points, streak_multiplier, match_results(external_match_id)').eq('prediction_id', theirPredId) : Promise.resolve({ data: null }),
  ])

  const drawData = (drawRow?.bracket_data as Draw | null) ?? null

  const matchResultsMap: Record<string, string> = Object.fromEntries(
    (resultsData ?? []).map((r: any) => [r.external_match_id, r.winner_external_id]),
  )
  const toPointsMap = (rows: any[] | null) => Object.fromEntries(
    (rows ?? [])
      .filter((r: any) => r.match_results?.external_match_id)
      .map((r: any) => [
        r.match_results.external_match_id,
        { points: r.points, streakMultiplier: r.streak_multiplier ?? 1 },
      ]),
  )
  const myMatchPoints    = toPointsMap(myPointsData as any[])
  const theirMatchPoints = toPointsMap(theirPointsData as any[])

  // ── Scope ────────────────────────────────────────────────────────────────
  const scopeIds = drawData
    ? matchIdsInScope(drawData.matches, drawData.rounds, challenge.scope_round)
    : null
  const scopeRounds = drawData
    ? roundsInScope(drawData.rounds, challenge.scope_round)
    : undefined

  const countInScope = (picks: Record<string, string>) =>
    scopeIds ? Object.keys(picks).filter(m => scopeIds.has(m)).length : Object.keys(picks).length

  const myPickCount    = countInScope(myPicks)
  const theirPickCount = countInScope(theirPicks)
  const scopeTotal     = scopeIds?.size ?? null

  // Matches still worth picking: in scope, no pick of mine, not yet played.
  const myOutstanding = scopeIds
    ? [...scopeIds].filter(m => !myPicks[m] && matchResultsMap[m] === undefined).length
    : 0

  // ── The reveal ───────────────────────────────────────────────────────────
  //
  // Replaces the both-locked gate. That rule made your side of the payoff
  // depend on an action only your opponent could take: if they never pressed
  // lock you saw nothing, for the whole tournament, having done everything
  // right. Since "Lock all picks" started deriving `is_fully_locked` from
  // "nothing left to pick" it got stricter still — on a slam it wanted 127
  // picks from each of you before either could see anything.
  //
  // What actually needs concealing is a pick on a match that has NOT been
  // played: reveal that and the second mover copies the bracket and the contest
  // is void. A pick on a match that is over cannot be copied — the result is
  // already known — so there is nothing left to protect. Each pick is a card
  // laid face-down on its match and turned over when that match finishes.
  //
  // This is also what the accept screen has always promised ("picks are
  // revealed as matches are played"); until now only the code's other half of
  // that sentence was true.
  const fullReveal = challenge.status === 'completed'
  const theirVisiblePicks: Record<string, string> = fullReveal
    ? theirPicks
    : Object.fromEntries(
        Object.entries(theirPicks).filter(([matchId]) => matchResultsMap[matchId] !== undefined),
      )
  const theirHiddenCount = Object.keys(theirPicks).length - Object.keys(theirVisiblePicks).length

  // Pending challenges only auto-expire for completed tournaments (not in_progress)
  const effectiveStatus =
    ['pending', 'draft'].includes(challenge.status) && tournament?.status === 'completed'
      ? 'expired'
      : challenge.status

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const predictHref = `/tournaments/${challenge.tournament_id}/predict?challenge=${challenge.id}`

  const scopeIsPartial = Boolean(challenge.scope_round)

  /** Shown on every state that has a bracket behind it. */
  const bracketPanel = drawData ? (
    <ChallengePicksTabs
      tournament={tournament}
      draw={drawData}
      myPicks={myPicks}
      theirPicks={theirVisiblePicks}
      myUsername={myUsername ?? 'You'}
      theirUsername={theirUsername ?? 'Opponent'}
      matchResults={matchResultsMap}
      myMatchPoints={myMatchPoints}
      theirMatchPoints={theirMatchPoints}
      scopeRounds={scopeRounds}
      progressiveReveal={!fullReveal}
      theirHiddenCount={theirHiddenCount}
      opponentJoined={['accepted', 'completed'].includes(challenge.status)}
    />
  ) : null

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" userId={user.id} />

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
            {tournament?.flag_emoji && <span style={{ marginRight: '3px' }}>{tournament.flag_emoji}</span>}
            {tournament?.location ?? tournament?.name} · {tournament?.tour} · {tournament?.starts_at ? formatDate(tournament.starts_at) : ''}
          </p>
          {scopeIsPartial && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--court)', letterSpacing: '0.05em', marginTop: '0.5rem' }}>
              {scopeLabel(challenge.scope_round).toUpperCase()}
              {scopeTotal !== null && <span style={{ color: 'var(--muted)' }}> · {scopeTotal} matches</span>}
            </p>
          )}
        </div>

        {/* ── Draft: picked, not yet sent ──────────────────────────────────── */}
        {effectiveStatus === 'draft' && (
          <div className="bg-white rounded-sm border p-5 md:p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.4rem' }}>
              Not sent yet
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
              {theirUsername} knows nothing about this until you send it. Fill in the bracket
              you want to defend first — the invite goes out carrying your picks, so there is
              something to answer rather than a bare name.
            </p>
            <div className="flex items-center gap-3 mb-4" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>
              <span style={{ color: myPickCount > 0 ? 'var(--court)' : 'var(--muted)' }}>
                {myPickCount}{scopeTotal !== null ? ` / ${scopeTotal}` : ''} picked
              </span>
              {myOutstanding > 0 && <span>· {myOutstanding} still open</span>}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-start gap-3">
              <Link
                href={predictHref}
                className="inline-block text-center px-5 py-2.5 text-sm rounded-sm border whitespace-nowrap"
                style={{ borderColor: 'var(--chalk-dim)', color: 'var(--ink)', background: 'white', textDecoration: 'none' }}
              >
                {myPickCount > 0 ? 'Edit picks' : 'Make your picks'}
              </Link>
              <SendChallengeButton
                challengeId={challenge.id}
                opponentUsername={theirUsername ?? 'them'}
                canSend={myPickCount > 0}
              />
            </div>
            <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
              <CancelButton challengeId={challenge.id} isDraft />
            </div>
          </div>
        )}

        {/* ── Pending: needs response ─────────────────────────────────────── */}
        {effectiveStatus === 'pending' && isChallenged && (
          <div className="bg-white rounded-sm border p-5 md:p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>
              {challengerProfile?.username} is challenging you
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              Their bracket is already in{theirPickCount > 0 ? <> — <strong style={{ color: 'var(--ink)' }}>{theirPickCount} pick{theirPickCount === 1 ? '' : 's'}</strong></> : null}
              {scopeIsPartial ? <> across {scopeLabel(challenge.scope_round).toLowerCase()}</> : <> on {tournament?.name}</>}.
              Accept and fill in yours. Each pick stays face-down until its match is played,
              then both of yours turn over together.
            </p>
            <div className="flex flex-wrap gap-3">
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
          <div className="bg-white rounded-sm border p-5 md:p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', marginBottom: '0.4rem' }}>
              Waiting for {theirUsername}
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.6 }}>
              Your bracket is in and they have been told. You can keep editing until they accept.
            </p>
            <div className="flex items-center gap-3 mb-4" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>
              <span>{myPickCount}{scopeTotal !== null ? ` / ${scopeTotal}` : ''} picked</span>
              {myOutstanding > 0 && <span>· {myOutstanding} still open</span>}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Link
                href={predictHref}
                className="inline-block text-center px-5 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90 whitespace-nowrap"
                style={{ background: 'var(--court)', textDecoration: 'none' }}
              >
                {myPickCount > 0 ? 'Edit your picks →' : 'Make your picks →'}
              </Link>
              <CancelButton challengeId={challenge.id} />
            </div>
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

        {/* ── Active ──────────────────────────────────────────────────────── */}
        {effectiveStatus === 'accepted' && (
          <ChallengeScoreboard
            myUsername={myUsername ?? 'You'}
            theirUsername={theirUsername ?? 'Opponent'}
            myPoints={myLivePoints}
            theirPoints={theirLivePoints}
            myPickCount={myPickCount}
            theirPickCount={theirPickCount}
            scopeTotal={scopeTotal}
            myOutstanding={myOutstanding}
            hiddenCount={theirHiddenCount}
            predictHref={predictHref}
          />
        )}

        {/* ── Completed ───────────────────────────────────────────────────── */}
        {effectiveStatus === 'completed' && (
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
              {formatPoints(myPoints ?? 0)} pts <span style={{ color: 'var(--muted)' }}>vs</span> {formatPoints(theirPoints ?? 0)} pts
            </p>
            {isDraw && myPredCount != null && (
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                {myPredCount} vs {theirPredCount} predictions made
              </p>
            )}
          </div>
        )}

        {/* The bracket, on every state that has one. There is deliberately no
            longer a challenge screen whose entire content is a grey box saying
            "waiting" — your own picks are always yours to look at. */}
        {['draft', 'pending', 'accepted', 'completed'].includes(effectiveStatus) && bracketPanel}

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
