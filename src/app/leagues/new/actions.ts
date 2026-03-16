'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export async function createLeague(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const name = formData.get('name') as string
  const description = formData.get('description') as string
  if (!name?.trim()) return { error: 'League name is required' }

  // Use admin client to bypass RLS — we've already verified the user is authenticated
  const admin = createAdminClient()

  const { data: league, error: leagueError } = await admin
    .from('leagues')
    .insert({ name: name.trim(), description: description?.trim() || null, owner_id: user.id })
    .select()
    .single()

  if (leagueError) return { error: leagueError.message }

  await admin
    .from('league_members')
    .insert({ league_id: league.id, user_id: user.id })

  redirect(`/leagues/${league.id}`)
}
