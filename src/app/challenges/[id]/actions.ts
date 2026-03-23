'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { insertNotifications } from '@/lib/notifications'

export async function cancelChallenge(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const challengeId = formData.get('challenge_id') as string
  if (!challengeId) throw new Error('Missing challenge_id')

  const admin = createAdminClient()

  // Verify: this user is the challenger and challenge is still pending
  const { data: challenge, error: fetchErr } = await admin
    .from('challenges')
    .select('id, challenged_id, tournament_id, status')
    .eq('id', challengeId)
    .eq('challenger_id', user.id)
    .eq('status', 'pending')
    .single()

  if (fetchErr || !challenge) {
    console.error('[cancelChallenge] lookup failed', { challengeId, userId: user.id, fetchErr })
    throw new Error('Challenge not found or cannot be cancelled')
  }

  const { error: updateErr } = await admin
    .from('challenges')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', challengeId)

  if (updateErr) {
    console.error('[cancelChallenge] update failed', updateErr)
    throw new Error('Failed to cancel challenge')
  }

  // Notify the challenged user
  try {
    const [{ data: challengerProfile }, { data: tournament }] = await Promise.all([
      admin.from('users').select('username').eq('id', user.id).single(),
      admin.from('tournaments').select('name, location, flag_emoji').eq('id', challenge.tournament_id).single(),
    ])
    await insertNotifications([{
      user_id:       challenge.challenged_id,
      type:          'challenge_cancelled',
      tournament_id: challenge.tournament_id,
      meta: {
        challenger_username: challengerProfile?.username ?? 'Someone',
        tournament_name:     tournament?.name            ?? 'a tournament',
        tournament_location: tournament?.location ?? null,
        tournament_flag_emoji: tournament?.flag_emoji ?? null,
      },
    }])
  } catch (e) {
    console.error('[cancelChallenge] notification error', e)
  }

  revalidatePath(`/challenges/${challengeId}`)
  revalidatePath('/challenges')
  redirect('/challenges')
}

export async function respondToChallenge(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const challengeId = formData.get('challenge_id') as string
  const response    = formData.get('response') as 'accepted' | 'declined'

  if (!challengeId || !['accepted', 'declined'].includes(response)) {
    return { error: 'Invalid request' }
  }

  const admin = createAdminClient()

  // Verify: this user is the challenged party and challenge is pending
  const { data: challenge } = await admin
    .from('challenges')
    .select('id, challenger_id, tournament_id, status')
    .eq('id', challengeId)
    .eq('challenged_id', user.id)
    .eq('status', 'pending')
    .single()

  if (!challenge) return { error: 'Challenge not found or already responded' }

  // If accepting, only block for completed tournaments
  // (in_progress is now allowed — users can predict unplayed matches)
  if (response === 'accepted') {
    const { data: tournament } = await admin
      .from('tournaments')
      .select('status')
      .eq('id', challenge.tournament_id)
      .single()

    if (tournament?.status === 'completed') {
      await admin
        .from('challenges')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', challengeId)
      return { error: 'This challenge has expired — the tournament has already completed.' }
    }
  }

  await admin
    .from('challenges')
    .update({ status: response, updated_at: new Date().toISOString() })
    .eq('id', challengeId)

  revalidatePath(`/challenges/${challengeId}`)
  revalidatePath('/challenges')

  if (response === 'accepted') {
    // Create a challenge-specific prediction row for the accepting user
    // (empty picks — they'll fill it in on the predict page)
    await admin
      .from('predictions')
      .insert({
        user_id:       user.id,
        tournament_id: challenge.tournament_id,
        challenge_id:  challengeId,
        picks:         {},
        pick_locks:    {},
        submitted_at:  new Date().toISOString(),
      } as any)

    // Also create one for the challenger if they don't have one yet
    const { data: challengerPred } = await admin
      .from('predictions')
      .select('id')
      .eq('user_id', challenge.challenger_id)
      .eq('tournament_id', challenge.tournament_id)
      .eq('challenge_id', challengeId)
      .maybeSingle()

    if (!challengerPred) {
      await admin
        .from('predictions')
        .insert({
          user_id:       challenge.challenger_id,
          tournament_id: challenge.tournament_id,
          challenge_id:  challengeId,
          picks:         {},
          pick_locks:    {},
          submitted_at:  new Date().toISOString(),
        } as any)
    }

    // Redirect to make their picks for this challenge
    redirect(`/tournaments/${challenge.tournament_id}/predict?challenge=${challengeId}`)
  }
}
