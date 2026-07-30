import { ImageResponse } from 'next/og'
import { getSlam, type SlamSlug } from './config'
import { getSlamEditions } from './data'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const SURFACE_LABEL: Record<string, string> = {
  grass: 'Grass',
  clay: 'Clay',
  hard: 'Hard',
}

/**
 * Builds the OG image component for one slam. Each route's
 * `opengraph-image.tsx` is a thin re-export of this, so the layout lives in one
 * place while the colours stay per-slam.
 *
 * Modelled on src/app/tournaments/[id]/opengraph-image.tsx — same 1200x630
 * frame and typography, recoloured from the slam's accent palette.
 */
export function makeSlamOgImage(slug: SlamSlug) {
  return async function SlamOGImage() {
    const config = getSlam(slug)
    const editions = await getSlamEditions(config)

    const heading = `${config.name} Bracket Challenge`
    const subline =
      editions.phase === 'offseason'
        ? `${config.city} · ${SURFACE_LABEL[config.surface] ?? ''}`
        : `${config.city} · ${editions.year ?? ''}`.trim().replace(/·\s*$/, '')

    return new ImageResponse(
      (
        <div
          style={{
            width: '1200px',
            height: '630px',
            display: 'flex',
            flexDirection: 'column',
            background: '#f5f2eb',
            padding: '64px 72px',
            fontFamily: 'Georgia, "Times New Roman", serif',
            borderTop: `16px solid ${config.accent.base}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: '18px',
              letterSpacing: '0.12em',
              color: '#5a5a52',
              fontFamily: 'Arial, sans-serif',
              textTransform: 'uppercase',
              marginBottom: 'auto',
            }}
          >
            Quiet Please
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div
                style={{
                  display: 'flex',
                  background: config.accent.base,
                  color: '#fff',
                  fontSize: '14px',
                  fontFamily: 'Arial, sans-serif',
                  letterSpacing: '0.06em',
                  padding: '5px 14px',
                  borderRadius: '3px',
                  textTransform: 'uppercase',
                }}
              >
                Grand Slam
              </div>
              <div
                style={{
                  display: 'flex',
                  background: config.accent.soft,
                  color: config.accent.ink,
                  fontSize: '14px',
                  fontFamily: 'Arial, sans-serif',
                  letterSpacing: '0.06em',
                  padding: '5px 14px',
                  borderRadius: '3px',
                  textTransform: 'uppercase',
                }}
              >
                {SURFACE_LABEL[config.surface] ?? config.surface}
              </div>
            </div>

            <div
              style={{
                fontSize: heading.length > 30 ? '60px' : '72px',
                color: '#1a1a18',
                letterSpacing: '-0.02em',
                lineHeight: 1.05,
              }}
            >
              {heading}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div
                style={{
                  fontSize: '24px',
                  color: '#5a5a52',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                {subline}
              </div>
              <div
                style={{
                  display: 'flex',
                  background: config.accent.base,
                  color: '#fff',
                  fontSize: '20px',
                  fontFamily: 'Arial, sans-serif',
                  letterSpacing: '0.04em',
                  padding: '12px 28px',
                  borderRadius: '4px',
                }}
              >
                Fill out your bracket
              </div>
            </div>
          </div>
        </div>
      ),
      { ...size },
    )
  }
}
