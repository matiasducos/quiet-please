import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import Link from 'next/link'
import Nav from '@/components/Nav'

// Challenges are always open for accepting_predictions + in_progress regardless of prediction mode toggle
const CHALLENGE_STATUSES = ['accepting_predictions', 'in_progress']

export default async function CreateChallengePage() {
  // Optional auth — works for both anonymous and logged-in users
  const { profile } = await getNavProfile().catch(() => ({ user: null, profile: null }))
  const admin = createAdminClient()

  const { data: tournaments } = await admin
    .from('tournaments')
    .select('id, name, tour, category, surface, starts_at, ends_at, status, location, flag_emoji')
    .in('status', CHALLENGE_STATUSES)
    .order('starts_at', { ascending: true })

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" />

      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/challenges" style={{ color: 'var(--muted)' }}>Challenges</Link>
          <span>/</span>
          <span>Create</span>
        </div>

        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Create a challenge
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', lineHeight: 1.65, marginTop: '0.4rem' }}>
            Pick a tournament, fill in your bracket, and share the link with a friend. No account needed.
          </p>
        </div>

        {(!tournaments || tournaments.length === 0) ? (
          <div className="bg-white rounded-sm border py-16 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>No tournaments available</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              Check back soon — challenges open when tournament draws are published.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tournaments.map((t: any) => (
              <Link
                key={t.id}
                href={`/challenges/create/${t.id}`}
                className="flex items-center justify-between bg-white rounded-sm border px-5 py-4 tournament-card"
                style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
              >
                <div className="min-w-0 flex-1">
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: 'var(--ink)', marginBottom: '0.15rem' }}>
                    {t.flag_emoji && <span style={{ marginRight: '4px' }}>{t.flag_emoji}</span>}
                    {t.location ?? t.name}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                    {t.name} · {t.tour} · {t.surface ?? ''}
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                  {t.status === 'in_progress' && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--court)', letterSpacing: '0.06em' }}>
                      LIVE
                    </span>
                  )}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)' }}>
                    Challenge →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
