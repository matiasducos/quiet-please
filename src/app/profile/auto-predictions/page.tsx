import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAutoPredictConfig } from './actions'
import AutoPredictConfig from './AutoPredictConfig'
import Nav from '@/components/Nav'

export default async function AutoPredictionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const config = await getAutoPredictConfig()

  const { data: profile } = await supabase
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single()

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav />
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-10">
        <Link
          href={`/profile/${profile?.username ?? ''}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.05em', textDecoration: 'none' }}
        >
          ← Profile
        </Link>

        <h1
          className="mt-4"
          style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}
        >
          Auto-Predictions
        </h1>

        {!config.enabled ? (
          <div
            className="mt-6 p-6 rounded-sm border"
            style={{ background: '#fefce8', borderColor: '#fde68a' }}
          >
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#92400e' }}>
              This feature is not yet available for your account. Contact the admin to get access.
            </p>
          </div>
        ) : (
          <>
            <p
              className="mt-3"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.6 }}
            >
              Select up to 5 players per tour in priority order. When a draw is published,
              predictions are generated automatically and locked immediately — you won&apos;t be
              able to edit them. You can set a default list for all surfaces, or override for
              specific surfaces.
            </p>

            <div
              className="mt-4 px-4 py-3 rounded-sm border"
              style={{ background: '#fef2f2', borderColor: '#fecaca' }}
            >
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#991b1b', lineHeight: 1.5 }}>
                <strong>Important:</strong> Auto-predictions are fully locked on creation. You
                cannot change them after they are generated. Make sure you are happy with your
                player selections before saving.
              </p>
            </div>

            <AutoPredictConfig initialConfig={config} />
          </>
        )}
      </div>
    </main>
  )
}
