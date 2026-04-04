import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

const TOURNAMENT_FIELDS = 'id, name, tour, surface, category, starts_at, ends_at, status, location, flag_emoji'

/**
 * Cached query for upcoming tournaments (shared across all users).
 * Revalidates every 60s or when tournament-list tag is busted.
 */
export const getUpcomingTournaments = unstable_cache(
  async (limit: number = 3) => {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tournaments')
      .select(TOURNAMENT_FIELDS)
      .in('status', ['accepting_predictions', 'upcoming'])
      .order('starts_at', { ascending: true })
      .limit(limit)
    if (error) console.error('cached upcoming tournaments error:', error.message)
    return data ?? []
  },
  ['upcoming-tournaments'],
  { revalidate: 60, tags: ['tournament-list'] },
)

/**
 * Cached query for live (in_progress) tournaments (shared across all users).
 * Revalidates every 60s or when tournament-list tag is busted.
 */
export const getLiveTournaments = unstable_cache(
  async (limit: number = 4) => {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tournaments')
      .select(TOURNAMENT_FIELDS)
      .eq('status', 'in_progress')
      .order('starts_at', { ascending: true })
      .limit(limit)
    if (error) console.error('cached live tournaments error:', error.message)
    return data ?? []
  },
  ['live-tournaments'],
  { revalidate: 60, tags: ['tournament-list'] },
)
