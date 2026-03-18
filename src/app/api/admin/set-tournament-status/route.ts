import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const VALID_STATUSES = ['upcoming', 'draw_published', 'accepting_predictions', 'in_progress', 'completed'] as const

export async function POST(request: Request) {
  // In prod: verify the caller is an admin user
  if (process.env.NODE_ENV !== 'development') {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const adminIds = (process.env.ADMIN_USER_IDS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean)
    if (!adminIds.includes(user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const body = await request.json().catch(() => ({}))
  const { tournamentId, status } = body as { tournamentId?: string; status?: string }

  if (!tournamentId || !VALID_STATUSES.includes(status as any)) {
    return NextResponse.json({ error: 'Invalid tournamentId or status' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .update({ status })
    .eq('id', tournamentId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, tournamentId, status })
}
