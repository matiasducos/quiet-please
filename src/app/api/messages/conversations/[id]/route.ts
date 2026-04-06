import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'

/**
 * GET /api/messages/conversations/[id]?before=<ISO>&after=<ISO>&limit=50
 * Get messages in a conversation with cursor-based pagination.
 * - `before`: fetch older messages (scroll up / load more)
 * - `after`: fetch newer messages (polling for new messages)
 * - default: fetch most recent messages
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify user is a participant (RLS handles this, but we want a clear 404)
  const { data: convo, error: convoErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle()
  if (convoErr) return NextResponse.json({ error: convoErr.message }, { status: 500 })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const url = new URL(request.url)
  const before = url.searchParams.get('before')
  const after = url.searchParams.get('after')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 100)

  let query = supabase
    .from('messages')
    .select('id, sender_id, body, read_at, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) {
    query = query.lt('created_at', before)
  } else if (after) {
    // For polling: get messages newer than the last known timestamp
    query = supabase
      .from('messages')
      .select('id, sender_id, body, read_at, created_at')
      .eq('conversation_id', conversationId)
      .gt('created_at', after)
      .order('created_at', { ascending: true })
      .limit(limit)
  }

  const { data: messages, error: msgErr } = await query
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })

  // For the default and `before` queries, reverse to ascending order for display
  const sorted = (before || !after)
    ? (messages ?? []).reverse()
    : (messages ?? [])

  const result = sorted.map(m => ({
    id: m.id,
    senderId: m.sender_id,
    body: m.body,
    readAt: m.read_at,
    createdAt: m.created_at,
  }))

  return NextResponse.json({
    messages: result,
    hasMore: (messages ?? []).length === limit,
  })
}

/**
 * POST /api/messages/conversations/[id]
 * Send a message in a conversation.
 * Body: { body: string }
 * Response: { message: Message }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const reqBody = await request.json().catch(() => ({}))
  const messageBody = (reqBody.body ?? '').trim()

  if (!messageBody || messageBody.length > 2000) {
    return NextResponse.json({ error: 'Message must be 1–2000 characters' }, { status: 400 })
  }

  // Rate limit: 30 messages per minute
  const rl = rateLimit(`chat:send:${user.id}`, { maxRequests: 30, windowMs: 60_000 })
  if (rl.limited) {
    return NextResponse.json({ error: 'Too many messages, slow down' }, { status: 429 })
  }

  // Verify user is a participant
  const { data: convo, error: convoErr } = await supabase
    .from('conversations')
    .select('id, user1_id, user2_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (convoErr) return NextResponse.json({ error: convoErr.message }, { status: 500 })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  // Verify the other participant is still an accepted friend
  const friendId = convo.user1_id === user.id ? convo.user2_id : convo.user1_id
  const admin = createAdminClient()

  const { data: friendship } = await admin
    .from('friendships')
    .select('id')
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${user.id})`
    )
    .eq('status', 'accepted')
    .maybeSingle()

  if (!friendship) {
    return NextResponse.json({ error: 'You can only message accepted friends' }, { status: 403 })
  }

  // Insert the message (uses user client — RLS validates sender_id = auth.uid())
  const { data: msg, error: msgErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: messageBody,
    })
    .select('id, sender_id, body, read_at, created_at')
    .single()

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })

  // Bump last_message_at on the conversation (admin client — no UPDATE RLS policy)
  await admin
    .from('conversations')
    .update({ last_message_at: msg.created_at })
    .eq('id', conversationId)

  return NextResponse.json({
    message: {
      id: msg.id,
      senderId: msg.sender_id,
      body: msg.body,
      readAt: msg.read_at,
      createdAt: msg.created_at,
    },
  })
}
