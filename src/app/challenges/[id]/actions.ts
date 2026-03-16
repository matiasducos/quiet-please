'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

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
    .select('id, tournament_id, status')
    .eq('id', challengeId)
    .eq('challenged_id', user.id)
    .eq('status', 'pending')
    .single()

  if (!challenge) return { error: 'Challenge not found or already responded' }

  // If accepting, check tournament hasn't started yet
  if (response === 'accepted') {
    const { data: tournament } = await admin
      .from('tournaments')
      .select('status')
      .eq('id', challenge.tournament_id)
      .single()

    if (tournament?.status === 'in_progress' || tournament?.status === 'completed') {
      // Auto-expire instead
      await admin
        .from('challenges')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', challengeId)
      return { error: 'This challenge has expired — the tournament has already started.' }
    }
  }

  await admin
    .from('challenges')
    .update({ status: response, updated_at: new Date().toISOString() })
    .eq('id', challengeId)

  revalidatePath(`/challenges/${challengeId}`)
  revalidatePath('/challenges')

  if (response === 'accepted') {
    // Redirect to make their picks
    const { data: challenge2 } = await admin
      .from('challenges')
      .select('tournament_id')
      .eq('id', challengeId)
      .single()
    if (challenge2) redirect(`/tournaments/${challenge2.tournament_id}/predict`)
  }
}
