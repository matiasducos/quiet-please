import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import TestSandbox from './TestSandbox'
import { TEST_EXTERNAL_ID } from './constants'

export default async function TestTournamentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('username, total_points')
    .eq('id', user.id)
    .single()

  // Load test tournament state
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
      .select('id, picks, is_locked, points_earned')
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
      <Nav username={profile?.username} points={profile?.total_points ?? 0} activePage="test" />
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
