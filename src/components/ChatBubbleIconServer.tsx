import { createClient } from '@/lib/supabase/server'
import ChatBubbleIcon from './ChatBubbleIcon'

/**
 * Server component wrapper that fetches the initial unread message count and
 * passes it to the client-side ChatBubbleIcon (which then subscribes to
 * Realtime — see migration 091; it used to poll every 10 seconds).
 *
 * The count comes from my_unread_message_count(), the same SQL the Realtime
 * trigger uses, so the first paint and every later push agree by construction.
 * That matters more than it looks: the two used to be separate queries, and
 * the version here carried both of the silent-data-loss patterns this codebase
 * has been bitten by before — `.neq()`, which drops NULL sender_ids, and
 * `.in(conversationIds)`, which overflows the request URL once a user has
 * enough conversations and starts returning wrong counts with no error.
 *
 * Called with the request-scoped client, not the admin one: the function
 * derives the user from auth.uid(), so there is nothing to escalate for.
 */
export default async function ChatBubbleIconServer({ userId }: { userId: string }) {
  let initialCount = 0

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('my_unread_message_count')

  if (error) {
    // Render the icon without a badge rather than failing the nav. Logged
    // because a persistent failure here shows every user a permanently empty
    // badge, which looks like "no messages" rather than like a fault.
    console.error('[nav] unread count failed:', error.message)
  } else {
    initialCount = data ?? 0
  }

  return <ChatBubbleIcon initialCount={initialCount} userId={userId} />
}
