import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/messages/read
 * Mark all unread received messages in a conversation as read.
 * Body: { conversationId: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { conversationId } = body as { conversationId?: string }

  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  // Verify user is a participant (RLS check)
  const { data: convo, error: convoErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle()
  if (convoErr) return NextResponse.json({ error: convoErr.message }, { status: 500 })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  // Mark all messages from the friend as read
  // RLS update policy: sender_id != auth.uid() AND user is in conversation
  const { error: updateErr } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', user.id)
    .is('read_at', null)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
