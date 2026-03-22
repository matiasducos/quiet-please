'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

const VALID_TYPES = ['grand_slam', 'masters_1000', '500', '250'] as const

export async function createLeague(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const name = formData.get('name') as string
  const description = formData.get('description') as string
  const isPublic = formData.get('is_public') === 'true'
  const typesRaw = formData.get('tournament_types') as string | null

  if (!name?.trim()) return { error: 'League name is required' }

  // Parse & validate tournament types
  let allowedTypes: string[] | null = null
  if (typesRaw) {
    const parsed = typesRaw.split(',').filter(t => VALID_TYPES.includes(t as any))
    if (parsed.length > 0 && parsed.length < VALID_TYPES.length) {
      allowedTypes = parsed
    }
  }

  const admin = createAdminClient()

  const { data: league, error: leagueError } = await admin
    .from('leagues')
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      owner_id: user.id,
      is_public: isPublic,
      allowed_tournament_types: allowedTypes,
    })
    .select()
    .single()

  if (leagueError) return { error: leagueError.message }

  await admin
    .from('league_members')
    .insert({ league_id: league.id, user_id: user.id })

  // Recalculate this member's points for this league
  await admin.rpc('recalculate_member_points', { p_league_id: league.id, p_user_id: user.id })

  revalidatePath('/leagues')
  redirect(`/leagues/${league.id}`)
}
