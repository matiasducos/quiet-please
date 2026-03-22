'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function joinLeague(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const code = (formData.get('code') as string)?.toUpperCase().trim()
  if (!code) return { error: 'Please enter an invite code' }

  const admin = createAdminClient()

  const { data: league } = await admin
    .from('leagues')
    .select('id, name')
    .eq('invite_code', code)
    .eq('is_active', true)
    .single()

  if (!league) return { error: 'Invalid invite code. Check the code and try again.' }

  const { data: existing } = await admin
    .from('league_members')
    .select('league_id')
    .eq('league_id', league.id)
    .eq('user_id', user.id)
    .single()

  if (existing) redirect(`/leagues/${league.id}`)

  const { error: joinError } = await admin
    .from('league_members')
    .insert({ league_id: league.id, user_id: user.id })

  if (joinError) return { error: joinError.message }

  revalidatePath(`/leagues/${league.id}`)
  revalidatePath('/leagues')
  redirect(`/leagues/${league.id}`)
}
