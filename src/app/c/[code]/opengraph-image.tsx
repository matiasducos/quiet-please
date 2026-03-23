import { ImageResponse } from 'next/og'
import { createAdminClient } from '@/lib/supabase/admin'

export const alt = 'Challenge on Quiet Please'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Revalidate the OG image infrequently — challenge data rarely changes
export const revalidate = 3600

export default async function Image({ params }: { params: { code: string } }) {
  const admin = createAdminClient()

  const { data: challenge } = await admin
    .from('challenges')
    .select('creator_name, opponent_name, tournaments(name, location, flag_emoji, category)')
    .eq('share_code', params.code)
    .eq('is_anonymous', true)
    .single()

  const tournament = challenge?.tournaments as any
  const creatorName  = challenge?.creator_name  ?? 'Someone'
  const flag         = tournament?.flag_emoji   ?? '🎾'
  const location     = tournament?.location     ?? tournament?.name ?? 'a tournament'

  // Category label
  const catMap: Record<string, string> = {
    grand_slam:   'Grand Slam',
    masters_1000: 'Masters 1000',
    atp_500: 'ATP 500', atp_250: 'ATP 250',
    wta_1000: 'WTA 1000', wta_500: 'WTA 500', wta_250: 'WTA 250',
  }
  const categoryLabel = catMap[tournament?.category ?? ''] ?? ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#F5F2EB',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 80px',
          position: 'relative',
          fontFamily: 'Georgia, serif',
        }}
      >
        {/* Top green bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '8px', background: '#1a6b3c' }} />

        {/* Brand */}
        <div style={{
          position: 'absolute', top: '32px', left: '60px',
          fontFamily: 'monospace', fontSize: '13px',
          color: 'rgba(44,95,46,0.65)', letterSpacing: '4px', textTransform: 'uppercase',
        }}>
          QUIET PLEASE
        </div>

        {/* Content */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '18px' }}>
          {/* Flag + category */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '56px', lineHeight: 1 }}>{flag}</span>
            {categoryLabel && (
              <div style={{
                fontFamily: 'monospace', fontSize: '13px',
                color: 'rgba(44,95,46,0.7)', letterSpacing: '3px', textTransform: 'uppercase',
                border: '1px solid rgba(44,95,46,0.3)',
                padding: '4px 12px', borderRadius: '3px',
              }}>
                {categoryLabel}
              </div>
            )}
          </div>

          {/* Main headline */}
          <div style={{ fontSize: '52px', fontWeight: 700, color: '#0d0d0d', lineHeight: 1.1, maxWidth: '820px' }}>
            {creatorName} challenged you
          </div>

          {/* Tournament name */}
          <div style={{ fontSize: '28px', color: '#6b6b6b', fontWeight: 400 }}>
            {location} bracket predictions
          </div>

          {/* CTA pill */}
          <div style={{
            marginTop: '12px',
            padding: '16px 48px',
            background: '#1a6b3c',
            color: 'white',
            fontSize: '20px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            letterSpacing: '1px',
          }}>
            Make your picks →
          </div>
        </div>

        {/* Bottom: no account needed note */}
        <div style={{
          position: 'absolute', bottom: '28px',
          fontFamily: 'monospace', fontSize: '12px',
          color: '#9b9b9b', letterSpacing: '2px', textTransform: 'uppercase',
        }}>
          No account needed · quietplease.app
        </div>
      </div>
    ),
    { ...size }
  )
}
