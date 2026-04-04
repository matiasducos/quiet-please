import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 192,
          height: 192,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1a6b3c',
          borderRadius: 38,
          fontFamily: 'Georgia, serif',
          fontSize: 110,
          fontWeight: 400,
          color: '#f5f2eb',
          letterSpacing: '-4px',
        }}
      >
        QP
      </div>
    ),
    { width: 192, height: 192 },
  )
}
