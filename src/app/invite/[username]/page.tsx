import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { formatPoints } from '@/lib/utils/format'

export async function generateMetadata(
  { params }: { params: Promise<{ username: string }> },
): Promise<Metadata> {
  const { username } = await params
  return {
    title: `${username} invited you · Quiet Please`,
    description: `${username} invited you to Quiet Please — predict tennis, earn points, compete with friends. Free to play.`,
  }
}

export default async function InviteLandingPage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const admin = createAdminClient()

  const { data: inviter } = await admin
    .from('users')
    .select('id, username, ranking_points')
    .ilike('username', username)
    .maybeSingle()

  if (!inviter) notFound()

  // Already logged-in users don't need to see a signup landing — send them
  // to their own invite page so they can share their link instead.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/invite')

  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--chalk)' }}
    >
      <div className="max-w-xl mx-auto w-full px-5 md:px-8 py-10 md:py-16 flex-1 flex flex-col justify-center">

        {/* QP logotype */}
        <Link
          href="/"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.15rem',
            color: 'var(--ink)',
            textDecoration: 'none',
            display: 'inline-block',
            marginBottom: '2.5rem',
            alignSelf: 'flex-start',
          }}
        >
          Quiet Please
        </Link>

        {/* ── Invite card ────────────────────────────────────────────── */}
        <div
          className="bg-white rounded-sm border p-6 md:p-8 mb-6"
          style={{ borderColor: 'var(--chalk-dim)' }}
        >
          <div className="flex items-center gap-4 mb-5">
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg,#eaf3de 0%, var(--court) 100%)',
                color: '#fff',
                fontFamily: 'var(--font-display)',
                fontSize: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {inviter.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
                color: 'var(--muted)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: '2px',
              }}>
                You&apos;ve been invited
              </p>
              <p style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.35rem',
                color: 'var(--ink)',
                letterSpacing: '-0.01em',
                lineHeight: 1.15,
              }}>
                <strong>{inviter.username}</strong> wants you on the court
              </p>
              {(inviter.ranking_points ?? 0) > 0 && (
                <p style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  color: 'var(--muted)',
                  letterSpacing: '0.04em',
                  marginTop: '4px',
                }}>
                  {formatPoints(inviter.ranking_points ?? 0)} ranking pts
                </p>
              )}
            </div>
          </div>

          <p style={{
            fontSize: '0.95rem',
            color: 'var(--ink)',
            lineHeight: 1.6,
            marginBottom: '0.75rem',
          }}>
            Quiet Please is a free tennis prediction game. Pick winners before the draw closes, earn points the same way ATP and WTA players do, and climb the global leaderboard.
          </p>
          <p style={{
            fontSize: '0.9rem',
            color: 'var(--muted)',
            lineHeight: 1.55,
          }}>
            Sign up via this link and <strong>{inviter.username}</strong> will automatically be added as your first friend — challenge them tournament by tournament from day one.
          </p>
        </div>

        {/* ── Primary CTA ───────────────────────────────────────────── */}
        <Link
          href={`/signup?ref=${encodeURIComponent(inviter.username)}`}
          className="block text-center"
          style={{
            background: 'var(--court)',
            color: '#fff',
            fontFamily: 'var(--font-display)',
            fontSize: '1.05rem',
            padding: '14px 18px',
            borderRadius: '2px',
            textDecoration: 'none',
            marginBottom: '0.75rem',
          }}
        >
          Join with {inviter.username} →
        </Link>

        <p
          className="text-center"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: 'var(--muted)',
            letterSpacing: '0.04em',
          }}
        >
          Already on Quiet Please?{' '}
          <Link href="/login" style={{ color: 'var(--court)', textDecoration: 'none' }}>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
