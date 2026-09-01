'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { insertNotifications } from '@/lib/notifications'
import { sendNotificationEmail, sendChallengeReceivedEmail } from '@/lib/email'
import { checkChallengeAchievements } from '@/lib/achievements/check'
import { notifyAchievements } from '@/lib/achievements/notify'
import { scopeLabel } from '@/lib/challenges/scope'

/**
 * Send a drafted challenge — the moment the other side first hears about it.
 *
 * Split out of `createChallenge` so the invite carries a bracket. It refuses to
 * send an empty one: a notification whose entire content is "someone challenged
 * you" is what the friends flow used to deliver, and it gave the recipient
 * nothing to react to.
 */
export async function sendChallenge(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const challengeId = formData.get('challenge_id') as string
  if (!challengeId) return { error: 'Missing challenge_id' }

  const admin = createAdminClient()

  const { data: challenge } = await admin
    .from('challenges')
    .select('id, challenged_id, tournament_id, status, scope_round')
    .eq('id', challengeId)
    .eq('challenger_id', user.id)
    .eq('status', 'draft')
    .single()

  if (!challenge) return { error: 'Challenge not found, or it has already been sent.' }

  // Refuse to send a bracket with nothing in it.
  const { data: myPred } = await admin
    .from('predictions')
    .select('picks')
    .eq('challenge_id', challengeId)
    .eq('user_id', user.id)
    .maybeSingle()

  const pickCount = Object.keys((myPred?.picks as Record<string, string> | null) ?? {}).length
  if (pickCount === 0) {
    return { error: 'Make at least one pick before sending the challenge.' }
  }

  // Atomic: the status guard stops a double submit sending two invites.
  const { data: updated } = await admin
    .from('challenges')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', challengeId)
    .eq('status', 'draft')
    .select('id')

  if (!updated || updated.length === 0) {
    return { error: 'Challenge was already sent.' }
  }

  try {
    const [{ data: challengerProfile }, { data: tournament }] = await Promise.all([
      admin.from('users').select('username').eq('id', user.id).single(),
      admin.from('tournaments').select('name, location, flag_emoji').eq('id', challenge.tournament_id).single(),
    ])

    await insertNotifications([{
      user_id:       challenge.challenged_id,
      type:          'challenge_received',
      tournament_id: challenge.tournament_id,
      meta: {
        challenger_username:   challengerProfile?.username ?? 'Someone',
        tournament_name:       tournament?.name            ?? 'a tournament',
        tournament_location:   tournament?.location ?? null,
        tournament_flag_emoji: tournament?.flag_emoji ?? null,
        // What the invite is actually worth reacting to: a bracket that already
        // exists, and how much of the draw it covers.
        challenge_id:          challengeId,
        pick_count:            pickCount,
        scope_label:           scopeLabel(challenge.scope_round),
      },
    }])

    // Await — Vercel freezes the runtime after redirect(), so fire-and-forget drops mail
    await sendNotificationEmail(challenge.challenged_id, 'challenge_received', sendChallengeReceivedEmail, (email, token) => ({
      to: email,
      challengerUsername:  challengerProfile?.username ?? 'Someone',
      tournamentName:      tournament?.name ?? 'a tournament',
      tournamentFlagEmoji: tournament?.flag_emoji ?? null,
      unsubscribeToken:    token,
    }))
  } catch (e) {
    console.error('[sendChallenge] notification error', e)
  }

  checkChallengeAchievements(admin, user.id)
    .then(results => notifyAchievements(admin, results))
    .catch(err => console.error('[sendChallenge] achievement check error', err))

  revalidatePath(`/challenges/${challengeId}`)
  revalidatePath('/challenges')
  redirect(`/challenges/${challengeId}`)
}

export async function cancelChallenge(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const challengeId = formData.get('challenge_id') as string
  if (!challengeId) throw new Error('Missing challenge_id')

  const admin = createAdminClient()

  // Verify: this user is the challenger and the challenge is still theirs to
  // withdraw. A draft qualifies — it is the same act, minus anyone to tell.
  const { data: challenge, error: fetchErr } = await admin
    .from('challenges')
    .select('id, challenged_id, tournament_id, status')
    .eq('id', challengeId)
    .eq('challenger_id', user.id)
    .in('status', ['draft', 'pending'])
    .single()

  if (fetchErr || !challenge) {
    console.error('[cancelChallenge] lookup failed', { challengeId, userId: user.id, fetchErr })
    throw new Error('Challenge not found or cannot be cancelled')
  }

  // A draft is DELETED rather than filed as 'cancelled'.
  //
  // It was never announced, so there is no history to preserve and nobody to
  // tell. Marking it cancelled would also quietly corrupt two things that
  // already existed: the Challenger / Challenge Master achievements count every
  // non-anonymous row this user created, and 'cancelled' has always meant "a
  // challenge that was sent and then withdrawn". The challenge-scoped
  // prediction row goes with it — `predictions.challenge_id` is ON DELETE
  // CASCADE (migration 015).
  if (challenge.status === 'draft') {
    const { error: deleteErr } = await admin
      .from('challenges')
      .delete()
      .eq('id', challengeId)
      .eq('status', 'draft')

    if (deleteErr) {
      console.error('[cancelChallenge] draft delete failed', deleteErr)
      throw new Error('Failed to discard the draft')
    }

    revalidatePath('/challenges')
    redirect('/challenges')
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

  // Atomic update: WHERE status='pending' prevents double-accept race conditions
  const { data: updated } = await admin
    .from('challenges')
    .update({ status: response, updated_at: new Date().toISOString() })
    .eq('id', challengeId)
    .eq('status', 'pending')
    .select('id')

  if (!updated || updated.length === 0) {
    return { error: 'Challenge was already responded to' }
  }

  revalidatePath(`/challenges/${challengeId}`)
  revalidatePath('/challenges')

  if (response === 'accepted') {
    // Deliberately no prediction rows are created here.
    //
    // This used to upsert an empty bracket for each side with
    // `onConflict: 'user_id,tournament_id,challenge_id'`. There is no unique
    // constraint on that triple, so every one of those calls returned 42P10 and
    // wrote nothing — unnoticed since challenges shipped, because the return
    // value was never checked and `savePrediction` creates the row on the first
    // real save regardless. Every reader already treats a missing row as "no
    // picks yet", which is true for a challenge nobody has picked in.
    redirect(`/tournaments/${challenge.tournament_id}/predict?challenge=${challengeId}`)
  }
}
