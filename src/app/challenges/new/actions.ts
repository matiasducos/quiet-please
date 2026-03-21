'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { insertNotifications } from '@/lib/notifications'

export async function createChallenge(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const friendId     = formData.get('friend_id') as string
  const tournamentId = formData.get('tournament_id') as string
  if (!friendId || !tournamentId) return { error: 'Missing required fields' }

  const admin = createAdminClient()

  // Verify an accepted friendship exists in either direction
  const { data: friendship } = await admin
    .from('friendships')
    .select('id')
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${friendId}),` +
      `and(requester_id.eq.${friendId},addressee_id.eq.${user.id})`
    )
    .eq('status', 'accepted')
    .maybeSingle()

  if (!friendship) return { error: 'No accepted friendship with this user' }

  // Allow challenges for upcoming, accepting_predictions, AND in_progress tournaments
  // (users can still predict unplayed matches during in_progress)
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, status')
    .eq('id', tournamentId)
    .single()

  if (!tournament) return { error: 'Tournament not found' }
  if (tournament.status === 'completed') {
    return { error: 'Cannot create challenges for completed tournaments' }
  }

  // Prevent duplicate challenges: check if an active challenge already exists
  // between these two users (in either direction) for this tournament
  const { data: existing } = await admin
    .from('challenges')
    .select('id')
    .eq('tournament_id', tournamentId)
    .in('status', ['pending', 'accepted'])
    .or(
      `and(challenger_id.eq.${user.id},challenged_id.eq.${friendId}),` +
      `and(challenger_id.eq.${friendId},challenged_id.eq.${user.id})`
    )
    .maybeSingle()

  if (existing) {
    return { error: 'An active challenge already exists with this friend for this tournament' }
  }

  const { error } = await admin
    .from('challenges')
    .insert({
      challenger_id: user.id,
      challenged_id: friendId,
      tournament_id: tournamentId,
    })

  if (error) return { error: error.message }

  // Notify the challenged user
  try {
    const [{ data: challengerProfile }, { data: tournamentForNotif }] = await Promise.all([
      admin.from('users').select('username').eq('id', user.id).single(),
      admin.from('tournaments').select('name').eq('id', tournamentId).single(),
    ])
    await insertNotifications([{
      user_id:       friendId,
      type:          'challenge_received',
      tournament_id: tournamentId,
      meta: {
        challenger_username: challengerProfile?.username ?? 'Someone',
        tournament_name:     tournamentForNotif?.name    ?? 'a tournament',
      },
    }])
  } catch (e) {
    console.error('[createChallenge] notification error', e)
  }

  redirect('/challenges')
}
