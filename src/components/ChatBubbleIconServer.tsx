import { createClient } from '@/lib/supabase/server'
import ChatBubbleIcon from './ChatBubbleIcon'

/**
 * Server component wrapper that fetches the initial unread message count
 * and passes it to the client-side ChatBubbleIcon (which then polls).
 * Same pattern as NotificationBell.tsx.
 */
export default async function ChatBubbleIconServer({ userId }: { userId: string }) {
  let initialCount = 0

  try {
    const supabase = await createClient()

    // Get conversation IDs the user is part of
    const { data: convos } = await supabase
      .from('conversations')
      .select('id')
    const convoIds = (convos ?? []).map(c => c.id)

    if (convoIds.length > 0) {
      // Count unread messages across all conversations
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', convoIds)
        .neq('sender_id', userId)
        .is('read_at', null)
      initialCount = count ?? 0
    }
  } catch {
    // Tables may not exist yet — render icon without badge
  }

  return <ChatBubbleIcon initialCount={initialCount} />
}
