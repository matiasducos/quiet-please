#!/bin/bash
set -e

# ── Logout route ─────────────────────────────────────────────
mkdir -p src/app/auth/logout
cat > src/app/auth/logout/route.ts << 'EOF'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const url = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  return NextResponse.redirect(new URL('/', url))
}
EOF

# ── Shared nav component ──────────────────────────────────────
mkdir -p src/components
cat > src/components/Nav.tsx << 'EOF'
import Link from 'next/link'

interface NavProps {
  username?: string | null
  points?: number
  activePage?: 'tournaments' | 'leaderboard' | 'leagues'
}

export default function Nav({ username, points = 0, activePage }: NavProps) {
  return (
    <nav className="flex items-center justify-between px-8 py-5 border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
      <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'var(--ink)' }}>
        Quiet Please
      </Link>
      <div className="flex items-center gap-6">
        <Link href="/tournaments" style={{ fontSize: '0.875rem', color: activePage === 'tournaments' ? 'var(--ink)' : 'var(--muted)', fontWeight: activePage === 'tournaments' ? 500 : 400 }}>
          Tournaments
        </Link>
        <Link href="/leaderboard" style={{ fontSize: '0.875rem', color: activePage === 'leaderboard' ? 'var(--ink)' : 'var(--muted)', fontWeight: activePage === 'leaderboard' ? 500 : 400 }}>
          Leaderboard
        </Link>
        <Link href="/leagues" style={{ fontSize: '0.875rem', color: activePage === 'leagues' ? 'var(--ink)' : 'var(--muted)', fontWeight: activePage === 'leagues' ? 500 : 400 }}>
          Leagues
        </Link>
        <div className="flex items-center gap-3 ml-4 pl-4 border-l" style={{ borderColor: 'var(--chalk-dim)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{username}</span>
          <span className="score-pill">{points} pts</span>
          <form action="/auth/logout" method="post">
            <button type="submit" style={{ fontSize: '0.8rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </nav>
  )
}
EOF

# ── Result sync cron ─────────────────────────────────────────
mkdir -p src/app/api/cron/sync-results
cat > src/app/api/cron/sync-results/route.ts << 'EOF'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tennisAdapter } from '@/lib/tennis'

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('id, external_id, name')
      .in('status', ['accepting_predictions', 'in_progress'])

    if (!tournaments?.length) {
      return NextResponse.json({ message: 'No active tournaments', synced: 0 })
    }

    const results = []

    for (const tournament of tournaments) {
      try {
        const matchResults = await tennisAdapter.getResults(tournament.external_id)

        if (!matchResults.length) {
          results.push({ name: tournament.name, status: 'no_results' })
          continue
        }

        const rows = matchResults.map(r => ({
          tournament_id:      tournament.id,
          external_match_id:  r.externalMatchId,
          round:              r.round,
          winner_external_id: r.winnerExternalId,
          loser_external_id:  r.loserExternalId,
          score:              r.score,
          played_at:          r.playedAt,
        }))

        const { error } = await supabase
          .from('match_results')
          .upsert(rows, { onConflict: 'tournament_id,external_match_id' })

        if (error) {
          results.push({ name: tournament.name, status: 'error', error: error.message })
          continue
        }

        // Update tournament to in_progress
        await supabase
          .from('tournaments')
          .update({ status: 'in_progress' })
          .eq('id', tournament.id)
          .eq('status', 'accepting_predictions')

        results.push({ name: tournament.name, status: 'synced', matches: matchResults.length })
      } catch (err) {
        results.push({ name: tournament.name, status: 'error', error: err instanceof Error ? err.message : 'Unknown' })
      }
    }

    return NextResponse.json({ message: 'Result sync complete', results })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
EOF

# ── Points engine cron ────────────────────────────────────────
mkdir -p src/app/api/cron/award-points
cat > src/app/api/cron/award-points/route.ts << 'EOF'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPointsForRound } from '@/lib/tennis'

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    // Get all match results that haven't been scored yet
    // (not in point_ledger)
    const { data: newResults } = await supabase
      .from('match_results')
      .select(`
        id,
        tournament_id,
        round,
        winner_external_id,
        tournaments (id, category)
      `)
      .not('id', 'in',
        supabase.from('point_ledger').select('match_result_id')
      )

    if (!newResults?.length) {
      return NextResponse.json({ message: 'No new results to score', awarded: 0 })
    }

    // Get all locked predictions for affected tournaments
    const tournamentIds = [...new Set(newResults.map(r => r.tournament_id))]

    const { data: predictions } = await supabase
      .from('predictions')
      .select('id, user_id, tournament_id, picks')
      .in('tournament_id', tournamentIds)
      .eq('is_locked', true)

    if (!predictions?.length) {
      return NextResponse.json({ message: 'No locked predictions found', awarded: 0 })
    }

    let totalAwarded = 0
    const ledgerRows: any[] = []
    const userPointsMap: Record<string, number> = {}
    const predictionPointsMap: Record<string, number> = {}

    for (const result of newResults) {
      const tournament = result.tournaments as any
      if (!tournament?.category) continue

      for (const prediction of predictions) {
        if (prediction.tournament_id !== result.tournament_id) continue

        const picks = prediction.picks as Record<string, string>

        // Find if any pick in this match matches the winner
        // picks format: { matchId: playerExternalId }
        const pickedWinnerId = Object.values(picks).find(
          playerId => playerId === result.winner_external_id
        )

        if (!pickedWinnerId) continue

        // Check that this pick was specifically for this match's round
        // by finding the matchId that had this pick
        const matchPickEntry = Object.entries(picks).find(
          ([, playerId]) => playerId === result.winner_external_id
        )
        if (!matchPickEntry) continue

        const isWinner = result.round === 'F'
        const points = getPointsForRound(
          tournament.category,
          result.round as any,
          isWinner
        )

        if (points <= 0) continue

        ledgerRows.push({
          user_id:         prediction.user_id,
          tournament_id:   result.tournament_id,
          match_result_id: result.id,
          round:           result.round,
          points,
        })

        userPointsMap[prediction.user_id] = (userPointsMap[prediction.user_id] ?? 0) + points
        predictionPointsMap[prediction.id] = (predictionPointsMap[prediction.id] ?? 0) + points
        totalAwarded++
      }
    }

    // Insert point ledger rows
    if (ledgerRows.length > 0) {
      const { error } = await supabase.from('point_ledger').insert(ledgerRows)
      if (error) throw error
    }

    // Update users.total_points
    for (const [userId, pts] of Object.entries(userPointsMap)) {
      await supabase.rpc('increment_user_points', { user_id: userId, points: pts })
    }

    // Update predictions.points_earned
    for (const [predId, pts] of Object.entries(predictionPointsMap)) {
      const { data: pred } = await supabase
        .from('predictions')
        .select('points_earned')
        .eq('id', predId)
        .single()
      await supabase
        .from('predictions')
        .update({ points_earned: (pred?.points_earned ?? 0) + pts })
        .eq('id', predId)
    }

    return NextResponse.json({
      message: 'Points awarded',
      new_results_processed: newResults.length,
      point_entries_created: ledgerRows.length,
      total_point_awards: totalAwarded,
    })
  } catch (err) {
    console.error('[award-points] Error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
EOF

echo "✅ Logout route, shared Nav, result sync, and points engine written"
