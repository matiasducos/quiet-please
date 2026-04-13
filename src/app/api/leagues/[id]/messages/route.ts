import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'

/**
 * GET /api/leagues/[id]/messages?before=<ISO>&after=<ISO>&limit=50
 * Fetch messages in a league group chat with cursor-based pagination.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leagueId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify membership
  const { data: membership, error: memErr } = await supabase
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 })
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

  const url = new URL(request.url)
  const before = url.searchParams.get('before')
  const after = url.searchParams.get('after')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 100)

  let query = supabase
    .from('league_messages')
    .select('id, sender_id, body, created_at, users(username)')
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) {
    query = query.lt('created_at', before)
  } else if (after) {
    query = supabase
      .from('league_messages')
      .select('id, sender_id, body, created_at, users(username)')
      .eq('league_id', leagueId)
      .gt('created_at', after)
      .order('created_at', { ascending: true })
      .limit(limit)
  }

  const { data: messages, error: msgErr } = await query
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })

  // For default and `before` queries, reverse to ascending order for display
  const sorted = (before || !after)
    ? (messages ?? []).reverse()
    : (messages ?? [])

  const result = sorted.map((m: any) => ({
    id: m.id,
    senderId: m.sender_id,
    senderUsername: m.users?.username ?? 'Unknown',
    body: m.body,
    createdAt: m.created_at,
  }))

  return NextResponse.json({
    messages: result,
    hasMore: (messages ?? []).length === limit,
  })
}

/**
 * POST /api/leagues/[id]/messages
 * Send a message in a league group chat.
 * Body: { body: string }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leagueId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const reqBody = await request.json().catch(() => ({}))
  const messageBody = (reqBody.body ?? '').trim()

  if (!messageBody || messageBody.length > 500) {
    return NextResponse.json({ error: 'Message must be 1–500 characters' }, { status: 400 })
  }

  // Rate limit: 20 messages per minute
  const rl = rateLimit(`league-chat:${user.id}`, { maxRequests: 20, windowMs: 60_000 })
  if (rl.limited) {
    return NextResponse.json({ error: 'Too many messages, slow down' }, { status: 429 })
  }

  // Verify membership
  const { data: membership, error: memErr } = await supabase
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 })
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

  // Insert message (RLS validates sender_id = auth.uid() + membership)
  const { data: msg, error: msgErr } = await supabase
    .from('league_messages')
    .insert({
      league_id: leagueId,
      sender_id: user.id,
      body: messageBody,
    })
    .select('id, sender_id, body, created_at')
    .single()

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })

  // Fetch sender username for response
  const { data: senderProfile } = await supabase
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single()

  return NextResponse.json({
    message: {
      id: msg.id,
      senderId: msg.sender_id,
      senderUsername: senderProfile?.username ?? 'Unknown',
      body: msg.body,
      createdAt: msg.created_at,
    },
  })
}
