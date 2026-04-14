import { cache } from 'react'
import { createClient } from './server'

export type NavProfile = {
  username: string
  ranking_points: number
  deletion_requested_at: string | null
}

/**
 * Fetch the current user's nav profile (username + ranking_points).
 * Deduplicated per request via React.cache() — multiple calls in the
 * same RSC render tree only hit the DB once.
 *
 * Returns null if not authenticated.
 */
export const getNavProfile = cache(async (): Promise<{
  user: { id: string } | null
  profile: NavProfile | null
}> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, profile: null }

  const { data: profile } = await supabase
    .from('users')
    .select('username, ranking_points, deletion_requested_at')
    .eq('id', user.id)
    .single()

  return { user, profile }
})
