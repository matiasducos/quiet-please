import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Quiet Please — Tennis Bracket Predictions'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OGImage() {
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
        }}
      >
        {/* QP monogram badge */}
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 28,
            background: '#1a6b3c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 32,
          }}
        >
          <span
            style={{
              fontSize: 72,
              fontFamily: 'Georgia, serif',
              color: '#f5f2eb',
              letterSpacing: '-2px',
              lineHeight: 1,
            }}
          >
            QP
          </span>
        </div>

        {/* App name */}
        <span
          style={{
            fontSize: 56,
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            color: '#0d0d0d',
            letterSpacing: '-1px',
          }}
        >
          Quiet Please
        </span>

        {/* Tagline */}
        <span
          style={{
            fontSize: 24,
            fontFamily: 'sans-serif',
            color: '#6b6b6b',
            marginTop: 16,
          }}
        >
          Tennis Bracket Predictions
        </span>
      </div>
    ),
    { ...size },
  )
}
