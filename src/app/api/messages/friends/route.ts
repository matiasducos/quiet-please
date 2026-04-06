import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/messages/friends
 * Returns the user's accepted friends (id + username).
 * Used by the "New message" friend picker on the /messages page.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Fetch accepted friendships (bidirectional)
  const { data: friendships, error: friendErr } = await admin
    .from('friendships')
    .select('requester_id, addressee_id')
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .eq('status', 'accepted')

  if (friendErr) return NextResponse.json({ error: friendErr.message }, { status: 500 })
  if (!friendships || friendships.length === 0) return NextResponse.json({ friends: [] })

  const friendIds = friendships.map(f =>
    f.requester_id === user.id ? f.addressee_id : f.requester_id
  )

  // Fetch usernames
  const { data: profiles, error: profErr } = await admin
    .from('users')
    .select('id, username')
    .in('id', friendIds)

  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 })

  const friends = (profiles ?? [])
    .map(p => ({ id: p.id, username: p.username }))
    .sort((a, b) => a.username.localeCompare(b.username))

  return NextResponse.json({ friends })
}
