import type { ComponentProps } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../auth'
import BracketPredictor from '@/app/tournaments/[slug]/predict/BracketPredictor'

export const metadata = { robots: { index: false, follow: false } }

const mono = { fontFamily: 'var(--font-mono)' } as const

/**
 * One user's bracket, read-only, for an admin.
 *
 * Addressed by prediction id rather than by the public
 * `/tournaments/<slug>/picks/<username>` URL, and that is not a stylistic
 * choice. A prediction id names the user, the edition AND the challenge
 * exactly; the public route takes a series slug, which middleware rewrites a
 * UUID into (308, dropping the year) and which then resolves to whichever
 * edition is currently *featured*. Auditing last year's Cincinnati through
 * that route would quietly show this year's bracket.
 *
 * Keeping it here also means the privilege lives behind `requireAdmin()` on an
 * admin route, instead of adding an access-control exception to a page the
 * whole internet can reach.
 */
export default async function AdminPredictionPage({
  params,
}: {
  params: Promise<{ predictionId: string }>
}) {
  await requireAdmin()
  const { predictionId } = await params
  const supabase = createAdminClient()

  // One unbroken select literal: the Supabase client parses this string at the
  // type level, and a `+` concatenation widens it to `string`, which collapses
  // the result type to GenericStringError.
  const { data, error } = await supabase
    .from('predictions')
    .select('id, user_id, tournament_id, challenge_id, picks, locked_picks, points_earned, is_fully_locked, pick_locks, updated_at')
    .eq('id', predictionId)
    .maybeSingle()

  if (error) throw new Error(`prediction lookup failed: ${error.message}`)
  if (!data) notFound()

  // Hand-typed at the boundary, as everywhere else in this repo: `Database` is
  // a placeholder, so the client's own inference has nothing to work from.
  const prediction = data as unknown as {
    id: string
    user_id: string
    tournament_id: string
    challenge_id: string | null
    picks: Record<string, string> | null
    locked_picks: string[] | null
    points_earned: number | null
    is_fully_locked: boolean | null
    pick_locks: Record<string, string> | null
    updated_at: string
  }

  const [{ data: tournament }, { data: draw }, { data: user }, { data: results }, { data: pointRows }] =
    await Promise.all([
      supabase.from('tournaments').select('*').eq('id', prediction.tournament_id).single(),
      supabase.from('draws').select('bracket_data').eq('tournament_id', prediction.tournament_id).single(),
      supabase.from('users').select('username, email').eq('id', prediction.user_id).single(),
      supabase
        .from('match_results')
        .select('external_match_id, winner_external_id')
        .eq('tournament_id', prediction.tournament_id),
      // Scoped by prediction_id, not by user + tournament: the same user can
      // hold a global bracket and a challenge bracket for one tournament, and
      // scoping by user would credit this bracket with the other one's points.
      supabase
        .from('point_ledger')
        .select('points, streak_multiplier, match_results(external_match_id)')
        .eq('prediction_id', prediction.id),
    ])

  if (!tournament || !draw?.bracket_data) notFound()

  const matchResults: Record<string, string> = Object.fromEntries(
    (results ?? []).map(r => [r.external_match_id, r.winner_external_id]),
  )

  // The generated types declare a to-one embed as an array while PostgREST
  // returns a bare object, so this is asserted rather than inferred.
  const ledger = (pointRows ?? []) as unknown as Array<{
    points: number
    streak_multiplier: number | null
    match_results: { external_match_id: string } | null
  }>

  const matchPoints: Record<string, { points: number; streakMultiplier: number }> = Object.fromEntries(
    ledger
      .filter(r => r.match_results?.external_match_id)
      .map(r => [
        r.match_results!.external_match_id,
        { points: r.points, streakMultiplier: r.streak_multiplier ?? 1 },
      ]),
  )

  const picks = prediction.picks ?? {}
  const latePicks: string[] = Array.isArray(prediction.locked_picks) ? prediction.locked_picks : []
  const label = [tournament.flag_emoji, tournament.location ?? tournament.name].filter(Boolean).join(' ')

  return (
    <>
      <div style={{ background: '#fef3c7', borderBottom: '1px solid #fde68a', padding: '10px 16px' }}>
        <div className="max-w-5xl mx-auto flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p style={{ ...mono, fontSize: '0.72rem', color: '#92400e', margin: 0 }}>
              Admin view — <strong>{user?.username ?? user?.email ?? 'unknown user'}</strong> · {label}
              {prediction.challenge_id ? ' · challenge bracket' : ''}
            </p>
            <p style={{ ...mono, fontSize: '0.65rem', color: '#92400e', margin: '2px 0 0', opacity: 0.85 }}>
              {prediction.is_fully_locked ? 'Locked' : 'Still editable'}
              {' · '}last edited {new Date(prediction.updated_at).toLocaleString('en-GB')}
              {latePicks.length > 0 && ` · ${latePicks.length} pick${latePicks.length === 1 ? '' : 's'} made after the match was locked`}
            </p>
          </div>
          <Link href="/admin/predictions" style={{ ...mono, fontSize: '0.7rem', color: '#92400e', whiteSpace: 'nowrap' }}>
            ← All predictions
          </Link>
        </div>
      </div>

      <BracketPredictor
        tournament={tournament}
        // `Draw` isn't exported from BracketPredictor, so the shape is pulled
        // off the component's own props rather than cast to `any`.
        draw={draw.bracket_data as ComponentProps<typeof BracketPredictor>['draw']}
        existingPicks={picks}
        predictionId={prediction.id}
        username={user?.username ?? 'this user'}
        returnUrl="/admin/predictions"
        matchResults={matchResults}
        matchPoints={matchPoints}
        pickLocks={prediction.pick_locks ?? {}}
        isFullyLocked={Boolean(prediction.is_fully_locked)}
        lockedPicks={latePicks}
        readOnly
      />
    </>
  )
}
