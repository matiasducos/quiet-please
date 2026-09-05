'use client'

import { useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * The live set of leagues with unread chat, shared by every dot on the page.
 *
 * A module singleton rather than a hook that fetches, because the dots are not
 * one component — the nav renders two (desktop link and mobile strip), the
 * leagues list renders one per row, and the league page renders one on the chat
 * tab. A self-fetching hook would put every one of those on its own timer: a
 * user in eight leagues sitting on /leagues would issue nine identical queries
 * a minute, and the number would grow with how many leagues they join.
 *
 * With one store the poll is O(1) in the number of dots. Subscribers share a
 * single interval that only exists while at least one dot is mounted.
 *
 * The query goes straight to Supabase, never through a Vercel route — migration
 * 091 explains why at length. A badge that polls a serverless function costs
 * Active CPU for every open tab whether or not anyone is doing anything; the
 * same request sent directly to Postgres costs none.
 *
 * There is deliberately no local "I read this" override layered on top of the
 * server's answer. chat_read_at is the only truth, and an override set would
 * have to be expired by hand — forget to, and a league the user once opened can
 * never light up again, which is a silent feature-off rather than a visible
 * bug. Opening a chat writes the marker and re-reads the set instead.
 */

// `null` means "the browser has not fetched yet", which is not the same as "no
// unread leagues". Until the first poll lands, each dot renders the value its
// server component already gave it — so the first paint is correct and
// hydration matches.
let snapshot: string[] | null = null

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function emit() {
  for (const listener of listeners) listener()
}

/**
 * Replaces the snapshot only when the set actually changed.
 *
 * useSyncExternalStore compares getSnapshot() by identity, so handing back a
 * fresh array every poll would re-render every dot on the page once a minute
 * forever. The RPC orders the ids (106), which is what makes an element-wise
 * comparison a valid equality test here rather than a coin flip.
 */
function apply(next: string[]) {
  const prev = snapshot
  if (prev && prev.length === next.length && prev.every((id, i) => id === next[i])) return
  snapshot = next
  emit()
}

async function refresh() {
  // A backgrounded tab has nobody looking at the dot. Same rule as the DM
  // badge: this is the difference between an idle tab costing nothing and
  // costing a query a minute for as long as it stays open.
  if (document.visibilityState !== 'visible') return

  const supabase = createClient()
  const { data, error } = await supabase.rpc('my_unread_league_ids')
  if (error || !Array.isArray(data)) return
  apply(data as string[])
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  if (listeners.size === 1) {
    // Refreshing on focus is the mechanism; the interval is the backstop. A
    // stale dot only matters while someone is looking at it, and coming back to
    // the tab is exactly when they start.
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    timer = setInterval(refresh, 60_000)
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      if (timer) clearInterval(timer)
      timer = null
    }
  }
}

function getSnapshot() {
  return snapshot
}

// Rendered on the server, where there is no store. Every dot falls back to the
// value its own server component fetched, so returning null here is correct
// rather than a gap.
function getServerSnapshot(): string[] | null {
  return null
}

/**
 * The leagues with unread chat: live once the browser has fetched, and the
 * server-rendered `initialIds` until then.
 */
export function useUnreadLeagues(initialIds: string[]): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) ?? initialIds
}

/**
 * Persist that the user is looking at this league's chat, then re-read the set.
 *
 * The optimistic clear only prunes a set we already hold. It does NOT seed an
 * empty one when the browser has not polled yet: that would blank the nav dot
 * for every OTHER league the user has unread, to hide a dot on the league they
 * are already reading. Waiting one round trip is the cheaper wrong.
 *
 * The re-read afterwards is what keeps every other dot honest — the write moved
 * the marker, so the server's answer for all leagues is now current, and taking
 * it wholesale beats maintaining a second opinion in the browser.
 */
export async function markLeagueChatRead(leagueId: string) {
  if (snapshot) apply(snapshot.filter(id => id !== leagueId))

  const supabase = createClient()
  const { error } = await supabase.rpc('mark_league_chat_read', { p_league_id: leagueId })

  // A failed write costs a stale dot and nothing else — the marker is a
  // timestamp, so the next open writes it again. Re-reading after a failure
  // would just re-light the dot the user is actively reading past.
  if (!error) await refresh()
}
