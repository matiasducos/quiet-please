'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

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

  // Verify tournament is upcoming or accepting_predictions
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, status')
    .eq('id', tournamentId)
    .single()

  if (!tournament) return { error: 'Tournament not found' }
  if (tournament.status === 'completed' || tournament.status === 'in_progress') {
    return { error: 'Challenges can only be created for upcoming tournaments' }
  }

  const { error } = await admin
    .from('challenges')
    .insert({
      challenger_id: user.id,
      challenged_id: friendId,
      tournament_id: tournamentId,
    })

  if (error) return { error: error.message }

  redirect('/challenges')
}
