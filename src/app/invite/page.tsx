import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import { getNavProfile } from '@/lib/supabase/profile'
import { getReferralStats } from '@/lib/referrals'
import InviteShare from './InviteShare'

export const metadata: Metadata = { title: 'Invite a friend | Quiet Please' }

export default async function InvitePage() {
  const { user, profile } = await getNavProfile()
  if (!user || !profile?.username) redirect('/login?redirectTo=/invite')

  // Build the absolute invite URL. Prefer the request host so previews/
  // localhost work; fall back to the canonical domain in production.
  const h = await headers()
  const host  = h.get('x-forwarded-host') ?? h.get('host') ?? 'quietplease.app'
  const proto = host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https'
  const inviteUrl = `${proto}://${host}/invite/${profile.username}`

  const stats = await getReferralStats(user.id)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav
        username={profile.username}
        points={profile.ranking_points ?? 0}
        userId={user.id}
        deletionRequestedAt={profile.deletion_requested_at}
      />

      <div className="max-w-2xl mx-auto px-4 md:px-8 py-10 md:py-14">

        <Link
          href={`/profile/${profile.username}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            color: 'var(--muted)',
            letterSpacing: '0.05em',
            textDecoration: 'none',
            display: 'inline-block',
            marginBottom: '16px',
          }}
        >
          ← Back to profile
        </Link>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="mb-8">
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: 'var(--court)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            marginBottom: '0.75rem',
          }}>
            Bring your people
          </p>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(1.75rem, 5vw, 2.5rem)',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            marginBottom: '0.75rem',
          }}>
            Invite a friend
          </h1>
          <p style={{ fontSize: '0.95rem', color: 'var(--muted)', lineHeight: 1.55 }}>
            Share your link. When a friend joins and makes their first prediction, you both get added as friends automatically — and you unlock a new <strong>Recruiter</strong> achievement at every tier: 1, 5, 10, and 25 invites.
          </p>
        </div>

        {/* ── Share ─────────────────────────────────────────────────── */}
        <div className="mb-10">
          <InviteShare url={inviteUrl} inviterName={profile.username} />
        </div>

        {/* ── Stats + tier tracker ──────────────────────────────────── */}
        <div
          className="bg-white rounded-sm border p-5 md:p-6 mb-8"
          style={{ borderColor: 'var(--chalk-dim)' }}
        >
          <div className="flex items-baseline justify-between mb-4">
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.1rem',
              letterSpacing: '-0.01em',
            }}>
              Your invites
            </h2>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.65rem',
              color: 'var(--muted)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              Lifetime
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-5">
            <StatBlock value={stats.total} label="Signed up" />
            <StatBlock value={stats.activated} label="Made first pick" accent />
          </div>

          <TierTracker activated={stats.activated} />
        </div>

        {/* ── Why friends make it better ─────────────────────────────── */}
        <div
          className="rounded-sm border p-5 md:p-6"
          style={{ background: '#eef4ff', borderColor: '#B8D4F0' }}
        >
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.65rem',
            color: '#185FA5',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginBottom: '0.5rem',
          }}>
            Why invite?
          </p>
          <p style={{ fontSize: '0.9rem', color: 'var(--ink)', lineHeight: 1.6, marginBottom: '0.5rem' }}>
            You&apos;ll share a head-to-head record on every challenge, see when friends lock their picks, and can start a private league together in seconds.
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            Predictions are always free. Your friend doesn&apos;t need a credit card or app install — just the link.
          </p>
        </div>

      </div>
      <Footer />
    </main>
  )
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function StatBlock({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="text-center" style={{ padding: '10px 0' }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: '2.25rem',
        letterSpacing: '-0.02em',
        color: accent ? 'var(--court)' : 'var(--ink)',
        lineHeight: 1,
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.62rem',
        color: 'var(--muted)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        marginTop: '6px',
      }}>
        {label}
      </div>
    </div>
  )
}

// Horizontal tier progress — highlights the next tier the user is working toward.
function TierTracker({ activated }: { activated: number }) {
  const tiers = [
    { min: 1,  name: 'Recruiter',           emoji: '📣' },
    { min: 5,  name: 'Connector',           emoji: '🔗' },
    { min: 10, name: 'Ambassador',          emoji: '🎤' },
    { min: 25, name: 'Tournament Director', emoji: '🏟️' },
  ]
  const nextTier = tiers.find(t => activated < t.min)

  return (
    <div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {tiers.map(tier => {
          const earned = activated >= tier.min
          return (
            <div
              key={tier.min}
              className="text-center rounded-sm"
              style={{
                padding: '10px 6px',
                border: earned ? '1px solid var(--court)' : '1px solid var(--chalk-dim)',
                background: earned ? '#eaf3de' : 'transparent',
                opacity: earned ? 1 : 0.6,
              }}
            >
              <div style={{ fontSize: '1.25rem', lineHeight: 1 }}>{tier.emoji}</div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.58rem',
                color: earned ? 'var(--court-dark)' : 'var(--muted)',
                letterSpacing: '0.06em',
                marginTop: '4px',
                textTransform: 'uppercase',
              }}>
                {tier.min}
              </div>
            </div>
          )
        })}
      </div>
      <p style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.7rem',
        color: 'var(--muted)',
        letterSpacing: '0.04em',
      }}>
        {nextTier
          ? `${nextTier.min - activated} more to unlock ${nextTier.emoji} ${nextTier.name}`
          : 'Max tier reached — thanks for bringing the crowd in 🎾'}
      </p>
    </div>
  )
}
