'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { rateLimit } from '@/lib/rate-limit'
import { trackServerEvent } from '@/lib/posthog/server'
import { OCCUPYING_STATUSES } from '@/lib/challenges/status'
import { availableScopes } from '@/lib/challenges/scope'
import type { Draw } from '@/lib/tennis/types'

/**
 * Create a challenge as a DRAFT and send the challenger straight to their picks.
 *
 * The invite used to go out here, before the challenger had picked anything, so
 * the recipient's notification said "X challenged you" with nothing behind it —
 * no bracket, no stake, nothing to react to. The friend flow was inverted
 * relative to the anonymous one, which has always made you pick before you can
 * share a link.
 *
 * Nothing is notified from this function any more. The row lands as 'draft',
 * which is invisible to the other side, and `sendChallenge` (in ../[id]/actions)
 * does the announcing once there is a bracket to announce.
 */
export async function createChallenge(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Rate limit: 5 challenge creations per minute per user
  const rl = rateLimit(`challenge:${user.id}`, { maxRequests: 5, windowMs: 60_000 })
  if (rl.limited) return { error: `Too many requests. Try again in ${rl.retryAfter}s.` }

  const friendId     = formData.get('friend_id') as string
  const tournamentId = formData.get('tournament_id') as string
  // Empty string is the "Full draw" option — normalise it to NULL rather than
  // storing '' , which would not match any round and read as a corrupt scope.
  const scopeRoundRaw = (formData.get('scope_round') as string | null)?.trim()
  const scopeRound = scopeRoundRaw ? scopeRoundRaw : null

  if (!friendId || !tournamentId) return { error: 'Missing required fields' }

  const admin = createAdminClient()

  // ── Parallel fetch: friendship + tournament + existing challenge ────────
  const [{ data: friendship }, { data: tournament }, { data: existing }] = await Promise.all([
    admin.from('friendships').select('id')
      .or(`and(requester_id.eq.${user.id},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${user.id})`)
      .eq('status', 'accepted')
      .maybeSingle(),
    admin.from('tournaments').select('id, status').eq('id', tournamentId).single(),
    admin.from('challenges').select('id, status')
      .eq('tournament_id', tournamentId)
      .in('status', OCCUPYING_STATUSES as unknown as string[])
      .or(`and(challenger_id.eq.${user.id},challenged_id.eq.${friendId}),and(challenger_id.eq.${friendId},challenged_id.eq.${user.id})`)
      .maybeSingle(),
  ])

  if (!friendship) return { error: 'No accepted friendship with this user' }
  if (!tournament) return { error: 'Tournament not found' }
  if (tournament.status === 'completed') {
    return { error: 'Cannot create challenges for completed tournaments' }
  }
  if (existing) {
    // A draft is the caller's own unsent challenge — sending them back to it is
    // more useful than telling them one exists.
    if (existing.status === 'draft') {
      redirect(`/tournaments/${tournamentId}/predict?challenge=${existing.id}`)
    }
    return { error: 'An active challenge already exists with this friend for this tournament' }
  }

  // ── Validate the scope against the draw ────────────────────────────────
  //
  // Re-derived here rather than trusted from the form: the option list is built
  // in the browser from the same helper, and a scope whose earlier rounds are
  // not settled would produce a bracket with empty feed-in slots.
  if (scopeRound) {
    const [{ data: drawRow }, { data: results }] = await Promise.all([
      admin.from('draws').select('bracket_data').eq('tournament_id', tournamentId).single(),
      admin.from('match_results').select('external_match_id, winner_external_id').eq('tournament_id', tournamentId),
    ])

    const draw = drawRow?.bracket_data as Draw | null
    if (!draw?.matches?.length) return { error: 'The draw for this tournament is not available yet' }

    const resultMap: Record<string, string> = Object.fromEntries(
      (results ?? []).map(r => [r.external_match_id, r.winner_external_id]),
    )
    const allowed = availableScopes(draw.matches, draw.rounds, resultMap)
    if (!allowed.some(o => o.round === scopeRound)) {
      return { error: 'That part of the draw is not available for a challenge yet.' }
    }
  }

  const { data: created, error } = await admin
    .from('challenges')
    .insert({
      challenger_id: user.id,
      challenged_id: friendId,
      tournament_id: tournamentId,
      status:        'draft',
      scope_round:   scopeRound,
    })
    .select('id')
    .single()

  if (error || !created) return { error: error?.message ?? 'Could not create the challenge' }

  // The challenger's own bracket row, so the predict page has something to load
  // rather than creating it as a side effect of the first save.
  await admin
    .from('predictions')
    .upsert(
      [{
        user_id:       user.id,
        tournament_id: tournamentId,
        challenge_id:  created.id,
        picks:         {},
        pick_locks:    {},
        submitted_at:  new Date().toISOString(),
      }] as any[],
      { onConflict: 'user_id,tournament_id,challenge_id', ignoreDuplicates: true },
    )

  trackServerEvent(user.id, 'challenge_created', {
    type: 'friend',
    tournament_id: tournamentId,
    scope_round: scopeRound ?? 'full',
  })

  // Achievements are checked when the challenge is actually sent, not here — a
  // draft nobody has seen should not earn a badge.

  redirect(`/tournaments/${tournamentId}/predict?challenge=${created.id}`)
}
