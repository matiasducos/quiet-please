import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * The leagues the current user has unread chat in, for the first paint.
 *
 * Deduplicated per request via React.cache(): the nav renders two dots (desktop
 * link and mobile strip) and the page below it may render several more, and all
 * of them want the same answer. Without this the leagues list would issue one
 * identical RPC per dot on the page.
 *
 * Request-scoped client, not the admin one — my_unread_league_ids() derives the
 * user from auth.uid(), so there is nothing to escalate for.
 */
export const getUnreadLeagueIds = cache(async (): Promise<string[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('my_unread_league_ids')

  if (error) {
    // No dot rather than no nav. Logged because a persistent failure here shows
    // every user a permanently empty badge, which reads as "nothing new" rather
    // than as a fault — the same trap ChatBubbleIconServer calls out.
    console.error('[leagues] unread ids failed:', error.message)
    return []
  }

  return Array.isArray(data) ? (data as string[]) : []
})
