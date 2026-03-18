import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Maximum points a perfect Grand Slam prediction can earn (sanity cap)
const MAX_SANDBOX_POINTS = 5000

export async function POST(request: Request) {
  // ── Auth: only logged-in users can persist sandbox points ──────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse + validate body ───────────────────────────────────────────────
  let points: number
  try {
    const body = await request.json()
    points = Number(body.points)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Number.isFinite(points) || points <= 0) {
    return NextResponse.json({ error: 'points must be a positive number' }, { status: 400 })
  }

  // Cap to prevent leaderboard abuse via repeated sandbox runs
  const awardedPoints = Math.min(Math.round(points), MAX_SANDBOX_POINTS)

  // ── Write via admin client (RPCs bypass RLS) ────────────────────────────
  const admin = createAdminClient()

  // Increment the user's ranking_points total
  const { error: incError } = await admin.rpc('increment_user_points', {
    user_id: user.id,
    points: awardedPoints,
  })

  if (incError) {
    console.error('[sandbox/simulate] increment_user_points failed:', incError)
    return NextResponse.json({ error: 'Failed to award points' }, { status: 500 })
  }

  // Recompute ranking position for this user
  const { error: rankError } = await admin.rpc('recalculate_ranking_points', {
    p_user_id: user.id,
  })

  if (rankError) {
    // Non-fatal — points are already saved; ranking will self-correct on next run
    console.error('[sandbox/simulate] recalculate_ranking_points failed:', rankError)
  }

  return NextResponse.json({ ok: true, awarded: awardedPoints })
}
