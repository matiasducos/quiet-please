import { ImageResponse } from 'next/og'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const alt = 'You\'ve been invited to Quiet Please'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Dynamic OG per inviter. Renders "<inviter> invited you" with their initial
// badge — turning every shared link into personalized social proof. Resolves
// the inviter from the URL segment; falls back to generic copy if not found
// so Facebook/Twitter/Slack unfurlers never see a 404.
export default async function InviteOGImage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const admin = createAdminClient()
  const { data: inviter } = await admin
    .from('users')
    .select('username')
    .ilike('username', username)
    .maybeSingle()

  const displayName = inviter?.username ?? 'A friend'
  const initial = displayName.charAt(0).toUpperCase()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f5f2eb',
          padding: 80,
          textAlign: 'center',
        }}
      >
        {/* Eyebrow */}
        <span
          style={{
            fontSize: 22,
            fontFamily: 'sans-serif',
            color: '#1a6b3c',
            letterSpacing: 4,
            textTransform: 'uppercase',
            marginBottom: 32,
          }}
        >
          You&apos;ve been invited
        </span>

        {/* Inviter avatar + name */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 28,
            marginBottom: 40,
          }}
        >
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              background: 'linear-gradient(135deg,#eaf3de 0%, #1a6b3c 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 72,
              fontFamily: 'Georgia, serif',
              color: '#ffffff',
            }}
          >
            {initial}
          </div>
          <span
            style={{
              fontSize: 72,
              fontFamily: 'Georgia, serif',
              color: '#0d0d0d',
              letterSpacing: '-2px',
              lineHeight: 1,
            }}
          >
            {displayName}
          </span>
        </div>

        {/* Headline */}
        <span
          style={{
            fontSize: 56,
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            color: '#0d0d0d',
            letterSpacing: '-1px',
            marginBottom: 24,
            maxWidth: 960,
          }}
        >
          Join them on Quiet Please
        </span>

        {/* Tagline */}
        <span
          style={{
            fontSize: 26,
            fontFamily: 'sans-serif',
            color: '#6b6b6b',
            maxWidth: 960,
          }}
        >
          Free tennis bracket predictions · ATP + WTA · Compete with friends
        </span>
      </div>
    ),
    { ...size },
  )
}
