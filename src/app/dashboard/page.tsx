import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('username, total_points')
    .eq('id', user.id)
    .single()

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="flex items-center justify-between px-8 py-5 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
        <Link href="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>
        <div className="flex items-center gap-4">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{profile?.username ?? user.email}</span>
          <span className="score-pill">{profile?.total_points ?? 0} pts</span>
        </div>
      </nav>
      <div className="px-8 py-16 max-w-4xl mx-auto text-center">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', marginBottom: '1rem' }}>
          Welcome back{profile?.username ? `, ${profile.username}` : ''}
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '1rem' }}>
          Tournament predictions are coming soon. Check back when the next draw is published.
        </p>
      </div>
    </main>
  )
}
