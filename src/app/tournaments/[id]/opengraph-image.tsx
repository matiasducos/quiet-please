import { ImageResponse } from 'next/og'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const TIER: Record<string, { label: string; bg: string; text: string }> = {
  'ATP|grand_slam':   { label: 'Grand Slam',   bg: '#1a1a2e', text: '#fff' },
  'ATP|masters_1000': { label: 'Masters 1000', bg: '#185FA5', text: '#fff' },
  'ATP|500':          { label: 'ATP 500',       bg: '#1e7a5e', text: '#fff' },
  'ATP|250':          { label: 'ATP 250',       bg: '#64748b', text: '#fff' },
  'WTA|grand_slam':   { label: 'Grand Slam',   bg: '#1a1a2e', text: '#fff' },
  'WTA|masters_1000': { label: 'WTA 1000',     bg: '#7c2d7c', text: '#fff' },
  'WTA|500':          { label: 'WTA 500',       bg: '#993556', text: '#fff' },
  'WTA|250':          { label: 'WTA 250',       bg: '#64748b', text: '#fff' },
}

const SURFACE: Record<string, { bg: string; text: string; label: string }> = {
  clay:  { bg: '#fde8df', text: '#993C1D', label: 'Clay' },
  grass: { bg: '#dcf0e4', text: '#1a6b3c', label: 'Grass' },
  hard:  { bg: '#dce8f7', text: '#185FA5', label: 'Hard' },
}

function formatDateRange(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt) return ''
  const start = new Date(startsAt)
  const year = start.getFullYear()
  if (!endsAt || endsAt === startsAt) {
    return start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const end = new Date(endsAt)
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ${start.toLocaleDateString('en-GB', { month: 'short' })} ${year}`
  }
  return `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${year}`
}

export default async function TournamentOGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('name, tour, category, surface, starts_at, ends_at')
    .eq('id', id)
    .single()

  const name = t?.name ?? 'Tournament'
  const tierKey = t ? `${t.tour}|${t.category}` : ''
  const tier = TIER[tierKey]
  const surface = t?.surface ? SURFACE[t.surface] : null
  const dateRange = formatDateRange(t?.starts_at ?? null, t?.ends_at ?? null)

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          background: '#f5f5ef',
          padding: '64px 72px',
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
      >
        {/* App name */}
        <div style={{
          display: 'flex',
          fontSize: '18px',
          letterSpacing: '0.12em',
          color: '#5a5a52',
          fontFamily: 'Arial, sans-serif',
          textTransform: 'uppercase',
          marginBottom: 'auto',
        }}>
          Quiet Please
        </div>

        {/* Main content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Badges row */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {tier && (
              <div style={{
                display: 'flex',
                background: tier.bg,
                color: tier.text,
                fontSize: '14px',
                fontFamily: 'Arial, sans-serif',
                letterSpacing: '0.06em',
                padding: '5px 14px',
                borderRadius: '3px',
                textTransform: 'uppercase',
              }}>
                {tier.label}
              </div>
            )}
            {surface && (
              <div style={{
                display: 'flex',
                background: surface.bg,
                color: surface.text,
                fontSize: '14px',
                fontFamily: 'Arial, sans-serif',
                letterSpacing: '0.06em',
                padding: '5px 14px',
                borderRadius: '3px',
                textTransform: 'uppercase',
              }}>
                {surface.label}
              </div>
            )}
          </div>

          {/* Tournament name */}
          <div style={{
            fontSize: name.length > 30 ? '60px' : '72px',
            color: '#1a1a18',
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            fontWeight: 'normal',
          }}>
            {name}
          </div>

          {/* Date + CTA */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {dateRange ? (
              <div style={{
                fontSize: '24px',
                color: '#5a5a52',
                fontFamily: 'Arial, sans-serif',
                letterSpacing: '0.01em',
              }}>
                {dateRange}
              </div>
            ) : <div />}
            <div style={{
              display: 'flex',
              background: '#6ba32a',
              color: '#fff',
              fontSize: '20px',
              fontFamily: 'Arial, sans-serif',
              letterSpacing: '0.04em',
              padding: '12px 28px',
              borderRadius: '4px',
            }}>
              Make your predictions
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
