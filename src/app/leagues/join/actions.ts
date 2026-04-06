'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { rateLimit } from '@/lib/rate-limit'
import { trackServerEvent } from '@/lib/posthog/server'

export async function joinLeague(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Rate limit invite code attempts to prevent brute-force
  const rl = rateLimit(`join-league:${user.id}`, { maxRequests: 10, windowMs: 60_000 })
  if (rl.limited) return { error: `Too many attempts. Try again in ${rl.retryAfter}s.` }

  const code = (formData.get('code') as string)?.toUpperCase().trim()
  if (!code) return { error: 'Please enter an invite code' }

  const admin = createAdminClient()

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, owner_id')
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

  // Recalculate this member's points for this league
  await admin.rpc('recalculate_member_points', { p_league_id: league.id, p_user_id: user.id })

  // Notify league owner
  const { data: joinerProfile } = await admin.from('users').select('username').eq('id', user.id).single()
  await admin.from('notifications').insert({
    user_id: league.owner_id,
    type: 'league_member_joined',
    meta: { league_id: league.id, league_name: league.name, joiner_username: joinerProfile?.username ?? 'Someone' },
  })

  trackServerEvent(user.id, 'league_joined', { league_id: league.id, method: 'invite_code' })

  revalidatePath(`/leagues/${league.id}`)
  revalidatePath('/leagues')
  redirect(`/leagues/${league.id}`)
}
