import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 512,
          height: 512,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1a6b3c',
          borderRadius: 102,
          fontFamily: 'Georgia, serif',
          fontSize: 290,
          fontWeight: 400,
          color: '#f5f2eb',
          letterSpacing: '-10px',
        }}
      >
        QP
      </div>
    ),
    { width: 512, height: 512 },
  )
}
