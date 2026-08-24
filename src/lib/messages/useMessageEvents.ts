'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Subscribe to this user's private Realtime topic and run `onMessage` whenever
 * a message lands in one of their conversations.
 *
 * This replaces three `setInterval(fetch, 10_000)` loops. The distinction that
 * matters is not "Realtime is faster" — it is that polling costs
 * O(users x time) serverless invocations while this costs O(messages actually
 * sent). An idle tab used to bill six invocations a minute forever; it now
 * bills none.
 *
 * The callback still fetches through the existing API routes. The broadcast is
 * only a signal that something changed (see migration 091 for why the message
 * body is deliberately not in the payload), so the authorization for reading
 * message content stays where it belongs — in the RLS policies on the table.
 *
 * `onMessage` is held in a ref so a caller passing an inline arrow does not
 * tear down and re-establish the websocket on every render. Only `userId`
 * should ever cause a resubscribe.
 */
export function useMessageEvents(
  userId: string | null | undefined,
  onMessage: (conversationId: string) => void,
) {
  // Synced in an effect, not during render: react-hooks/refs rightly rejects
  // mutating a ref while rendering. The effect below never reads it during the
  // same commit, so an effect-ordered assignment is soon enough.
  const handlerRef = useRef(onMessage)
  useEffect(() => { handlerRef.current = onMessage }, [onMessage])

  useEffect(() => {
    if (!userId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`user:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const id = (payload as { conversationId?: string })?.conversationId
        if (id) handlerRef.current(id)
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [userId])
}

/**
 * League chat variant. The topic is the league, not the user, so one broadcast
 * serves every connected member — see migration 091 for why that shape matters
 * once a league gets large.
 */
export function useLeagueMessageEvents(
  leagueId: string | null | undefined,
  onMessage: () => void,
) {
  // Synced in an effect, not during render: react-hooks/refs rightly rejects
  // mutating a ref while rendering. The effect below never reads it during the
  // same commit, so an effect-ordered assignment is soon enough.
  const handlerRef = useRef(onMessage)
  useEffect(() => { handlerRef.current = onMessage }, [onMessage])

  useEffect(() => {
    if (!leagueId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`league:${leagueId}`, { config: { private: true } })
      .on('broadcast', { event: 'message' }, () => handlerRef.current())
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [leagueId])
}
