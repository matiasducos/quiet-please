'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function savePrediction({
  tournamentId,
  picks,
  predictionId,
  lock = false,
}: {
  tournamentId: string
  picks: Record<string, string>
  predictionId: string | null
  lock?: boolean
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const row = {
    user_id:      user.id,
    tournament_id: tournamentId,
    picks,
    is_locked:    lock,
    updated_at:   new Date().toISOString(),
  }

  if (predictionId) {
    const { error } = await supabase
      .from('predictions')
      .update(row)
      .eq('id', predictionId)
      .eq('user_id', user.id)
      .eq('is_locked', false)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('predictions')
      .insert({ ...row, submitted_at: new Date().toISOString() })
    if (error) throw error
  }

  revalidatePath(`/tournaments/${tournamentId}`)
}
