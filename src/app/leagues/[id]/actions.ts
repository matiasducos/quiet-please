'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

const VALID_TYPES = ['grand_slam', 'masters_1000', '500', '250'] as const

export async function kickMember(leagueId: string, targetUserId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  // Verify caller is the league owner
  const { data: league } = await admin
    .from('leagues')
    .select('owner_id')
    .eq('id', leagueId)
    .single()

  if (!league || league.owner_id !== user.id) {
    return { error: 'Only the league owner can remove members' }
  }

  // Cannot kick yourself
  if (targetUserId === user.id) {
    return { error: 'You cannot remove yourself from the league' }
  }

  const { error } = await admin
    .from('league_members')
    .delete()
    .eq('league_id', leagueId)
    .eq('user_id', targetUserId)

  if (error) return { error: error.message }

  revalidatePath(`/leagues/${leagueId}`)
  return { success: true }
}

export async function joinPublicLeague(leagueId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  // Verify league exists and is public
  const { data: league } = await admin
    .from('leagues')
    .select('id, name, owner_id, is_public, is_active')
    .eq('id', leagueId)
    .single()

  if (!league || !league.is_public || !league.is_active) {
    return { error: 'League not found or is not public' }
  }

  // Check if already a member
  const { data: existing } = await admin
    .from('league_members')
    .select('league_id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single()

  if (existing) redirect(`/leagues/${leagueId}`)

  const { error } = await admin
    .from('league_members')
    .insert({ league_id: leagueId, user_id: user.id })

  if (error) return { error: error.message }

  // Notify league owner
  const { data: joinerProfile } = await admin.from('users').select('username').eq('id', user.id).single()
  await admin.from('notifications').insert({
    user_id: league.owner_id,
    type: 'league_member_joined',
    meta: { league_id: league.id, league_name: league.name, joiner_username: joinerProfile?.username ?? 'Someone' },
  })

  revalidatePath(`/leagues/${leagueId}`)
  revalidatePath('/leagues')
  revalidatePath('/leagues/browse')
  redirect(`/leagues/${leagueId}`)
}

export async function leaveLeague(leagueId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  // Fetch league to check ownership
  const { data: league } = await admin
    .from('leagues')
    .select('owner_id')
    .eq('id', leagueId)
    .single()

  if (!league) return { error: 'League not found' }

  if (league.owner_id === user.id) {
    // Owner is leaving — transfer ownership to the longest-standing member
    const { data: nextOwner } = await admin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId)
      .neq('user_id', user.id)
      .order('joined_at', { ascending: true })
      .limit(1)
      .single()

    if (nextOwner) {
      // Transfer ownership then remove self
      await admin
        .from('leagues')
        .update({ owner_id: nextOwner.user_id })
        .eq('id', leagueId)
    } else {
      // No other members — delete the league entirely
      await admin.from('leagues').delete().eq('id', leagueId)
      revalidatePath('/leagues')
      redirect('/leagues')
    }
  }

  // Remove self from league
  const { error } = await admin
    .from('league_members')
    .delete()
    .eq('league_id', leagueId)
    .eq('user_id', user.id)

  if (error) return { error: error.message }

  revalidatePath(`/leagues/${leagueId}`)
  revalidatePath('/leagues')
  redirect('/leagues')
}

export async function deleteLeague(leagueId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  // Verify caller is the league owner
  const { data: league } = await admin
    .from('leagues')
    .select('owner_id')
    .eq('id', leagueId)
    .single()

  if (!league || league.owner_id !== user.id) {
    return { error: 'Only the league owner can delete the league' }
  }

  // Delete league — league_members cascade-deleted via FK
  const { error } = await admin
    .from('leagues')
    .delete()
    .eq('id', leagueId)

  if (error) return { error: error.message }

  revalidatePath('/leagues')
  revalidatePath('/leagues/browse')
  redirect('/leagues')
}

export async function updateLeagueSettings(leagueId: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  // Verify caller is the league owner
  const { data: league } = await admin
    .from('leagues')
    .select('owner_id')
    .eq('id', leagueId)
    .single()

  if (!league || league.owner_id !== user.id) {
    return { error: 'Only the league owner can change settings' }
  }

  const typesRaw = formData.get('tournament_types') as string | null
  let allowedTypes: string[] | null = null
  if (typesRaw) {
    const parsed = typesRaw.split(',').filter(t => VALID_TYPES.includes(t as any))
    if (parsed.length > 0 && parsed.length < VALID_TYPES.length) {
      allowedTypes = parsed
    }
  }

  const { error } = await admin
    .from('leagues')
    .update({ allowed_tournament_types: allowedTypes })
    .eq('id', leagueId)

  if (error) return { error: error.message }

  revalidatePath(`/leagues/${leagueId}`)
  return { success: true }
}
