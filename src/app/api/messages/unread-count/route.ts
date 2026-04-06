import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/messages/unread-count
 * Returns the total number of unread messages across all conversations.
 * Polled by the ChatBubbleIcon in the nav every 10 seconds.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get all conversation IDs the user is part of
  const { data: convos, error: convErr } = await supabase
    .from('conversations')
    .select('id')
  if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 })

  if (!convos || convos.length === 0) {
    return NextResponse.json({ count: 0 })
  }

  const convoIds = convos.map(c => c.id)

  // Count unread messages (sent by someone else, not yet read)
  const { count, error: msgErr } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', convoIds)
    .neq('sender_id', user.id)
    .is('read_at', null)

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })

  return NextResponse.json({ count: count ?? 0 })
}
