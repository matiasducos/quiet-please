import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'

/**
 * GET /api/messages/conversations
 * List user's conversations with last message preview + unread count.
 * Polled by ConversationList every 10 seconds.
 *
 * Uses 3 batch queries (no N+1):
 *   1. Conversations (RLS-filtered)
 *   2. Friend profiles (user client, RLS allows reading all users)
 *   3. Recent messages + unread IDs (user client, RLS checks conversation membership)
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Fetch conversations (RLS ensures only user's conversations)
  const { data: convos, error: convErr } = await supabase
    .from('conversations')
    .select('id, user1_id, user2_id, last_message_at, created_at')
    .order('last_message_at', { ascending: false })
    .limit(50)
  if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 })
  if (!convos || convos.length === 0) return NextResponse.json({ conversations: [] })

  const friendIds = convos.map(c => c.user1_id === user.id ? c.user2_id : c.user1_id)
  const convoIds = convos.map(c => c.id)

  // 2. Batch fetch friend profiles (user client — RLS allows SELECT on all users)
  const { data: profiles, error: profErr } = await supabase
    .from('users')
    .select('id, username, avatar_url')
    .in('id', friendIds)
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 })
  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))

  // 3. Batch fetch recent messages and unread counts in parallel.
  //    For latest messages: fetch a generous batch ordered by created_at DESC,
  //    then pick the first per conversation in JS.
  //    For unread: fetch all unread message conversation_ids and count in JS.
  const [recentMsgsRes, unreadMsgsRes] = await Promise.all([
    supabase
      .from('messages')
      .select('conversation_id, sender_id, body, created_at')
      .in('conversation_id', convoIds)
      .order('created_at', { ascending: false })
      .limit(convoIds.length * 3), // 3x buffer covers interleaved convos
    supabase
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', convoIds)
      .neq('sender_id', user.id)
      .is('read_at', null),
  ])

  // Latest message per conversation (pick first occurrence per convo_id)
  const latestMessageMap = new Map<string, { body: string; senderId: string; createdAt: string }>()
  for (const msg of (recentMsgsRes.data ?? [])) {
    if (!latestMessageMap.has(msg.conversation_id)) {
      latestMessageMap.set(msg.conversation_id, {
        body: msg.body,
        senderId: msg.sender_id,
        createdAt: msg.created_at,
      })
    }
  }

  // Unread counts per conversation (count occurrences in JS — no N+1)
  const unreadCounts = new Map<string, number>()
  for (const row of (unreadMsgsRes.data ?? [])) {
    unreadCounts.set(row.conversation_id, (unreadCounts.get(row.conversation_id) ?? 0) + 1)
  }

  // Assemble response
  const conversations = convos.map(c => {
    const friendId = c.user1_id === user.id ? c.user2_id : c.user1_id
    const profile = profileMap.get(friendId)
    const lastMsg = latestMessageMap.get(c.id)
    return {
      id: c.id,
      friend: {
        id: friendId,
        username: profile?.username ?? 'Unknown',
        avatarUrl: profile?.avatar_url ?? null,
      },
      lastMessage: lastMsg ? {
        body: lastMsg.body,
        senderId: lastMsg.senderId,
        createdAt: lastMsg.createdAt,
      } : null,
      unreadCount: unreadCounts.get(c.id) ?? 0,
      updatedAt: c.last_message_at,
    }
  })

  return NextResponse.json({ conversations })
}

/**
 * POST /api/messages/conversations
 * Create or get a conversation with a friend (idempotent).
 * Body: { friendId: string }
 * Response: { conversationId: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { friendId } = body as { friendId?: string }

  if (!friendId || friendId === user.id) {
    return NextResponse.json({ error: 'Invalid friendId' }, { status: 400 })
  }

  // Rate limit
  const rl = rateLimit(`chat:create:${user.id}`, { maxRequests: 30, windowMs: 60_000 })
  if (rl.limited) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const admin = createAdminClient()

  // Verify accepted friendship (bidirectional check)
  const { data: friendship, error: friendErr } = await admin
    .from('friendships')
    .select('id')
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${user.id})`
    )
    .eq('status', 'accepted')
    .maybeSingle()

  if (friendErr) return NextResponse.json({ error: friendErr.message }, { status: 500 })
  if (!friendship) {
    return NextResponse.json({ error: 'No accepted friendship with this user' }, { status: 403 })
  }

  // Sort IDs to satisfy user1_id < user2_id constraint
  const [user1, user2] = user.id < friendId ? [user.id, friendId] : [friendId, user.id]

  // Check if conversation already exists
  const { data: existing, error: existErr } = await admin
    .from('conversations')
    .select('id')
    .eq('user1_id', user1)
    .eq('user2_id', user2)
    .maybeSingle()

  if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 })
  if (existing) return NextResponse.json({ conversationId: existing.id })

  // Create new conversation
  const { data: newConvo, error: createErr } = await admin
    .from('conversations')
    .insert({ user1_id: user1, user2_id: user2 })
    .select('id')
    .single()

  if (createErr) {
    // Handle race condition: unique constraint violation means it was just created
    if (createErr.code === '23505') {
      const { data: raced } = await admin
        .from('conversations')
        .select('id')
        .eq('user1_id', user1)
        .eq('user2_id', user2)
        .maybeSingle()
      if (raced) return NextResponse.json({ conversationId: raced.id })
    }
    return NextResponse.json({ error: createErr.message }, { status: 500 })
  }

  return NextResponse.json({ conversationId: newConvo.id })
}
