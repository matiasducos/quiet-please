import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/search/users?q=<query>
 * Returns matching usernames for the autocomplete dropdown.
 * Requires auth. Excludes the current user. Min 2 chars.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ users: [] })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ users: [] }, { status: 401 })

  const { data, error } = await supabase
    .from('users')
    .select('username')
    .ilike('username', `%${q}%`)
    .neq('id', user.id)
    .not('username', 'is', null)
    .order('username')
    .limit(8)

  if (error) {
    console.error('[search/users] error:', error)
    return NextResponse.json({ users: [] })
  }

  return NextResponse.json({
    users: (data ?? []).map(u => ({ username: u.username })),
  })
}
