'use server'

import { createClient } from '@/lib/supabase/server'
import { trackServerEvent } from '@/lib/posthog/server'
import { parseBracketView, type BracketView } from '@/lib/bracket/view'

/**
 * Remember which layout the signed-in user wants their brackets in.
 *
 * Signed-out visitors (the anonymous `/b` and `/c` flows) have no row to write,
 * so for them the switch lasts as long as the page does — which is why this
 * reports `saved: false` rather than an error: nothing went wrong.
 */
export async function setBracketView(
  view: BracketView,
  surface: string,
): Promise<{ saved: boolean; error?: string }> {
  const next = parseBracketView(view)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { saved: false }

  const { error } = await supabase
    .from('users')
    .update({ bracket_view: next })
    .eq('id', user.id)

  if (error) {
    console.error('[setBracketView]', error)
    return { saved: false, error: error.message }
  }

  trackServerEvent(user.id, 'bracket_view_changed', { view: next, surface })
  return { saved: true }
}
