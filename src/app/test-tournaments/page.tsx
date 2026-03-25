import { createClient } from '@/lib/supabase/server'
import { getNavProfile } from '@/lib/supabase/profile'
import { requireAdmin } from '@/app/admin/auth'
import Nav from '@/components/Nav'
import TestSandbox from './TestSandbox'
import { TEST_EXTERNAL_ID } from './constants'

export default async function TestTournamentsPage() {
  await requireAdmin()  // Gate: only admins (redirects non-admins to /dashboard)
  const { user, profile } = await getNavProfile()
  if (!user) return null  // Shouldn't happen after requireAdmin()

  // Load test tournament state
  const supabase = await createClient()
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('*')
    .eq('external_id', TEST_EXTERNAL_ID)
    .single()

  let prediction = null
  let hasResults = false

  if (tournament) {
    const { data: pred } = await supabase
      .from('predictions')
      .select('id, picks, is_fully_locked, points_earned')
      .eq('tournament_id', tournament.id)
      .eq('user_id', user.id)
      .single()
    prediction = pred ?? null

    const { count } = await supabase
      .from('match_results')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournament.id)
    hasResults = (count ?? 0) > 0
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="test" />
      <div className="max-w-2xl mx-auto px-8 py-10">

        {/* Page header */}
        <div className="mb-8">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em' }}>
              Test Sandbox
            </h1>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.08em',
              background: '#faeeda', color: '#633806', padding: '3px 9px', borderRadius: '2px',
            }}>
              DEV ONLY
            </span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', lineHeight: 1.6 }}>
            A fake Indian Wells tournament to test the full prediction flow — picks, locking, results, and scoring.
          </p>
        </div>

        <TestSandbox
          tournament={tournament ?? null}
          prediction={prediction}
          hasResults={hasResults}
        />
      </div>
    </main>
  )
}
