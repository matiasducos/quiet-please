import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Quiet Please — Tennis Bracket Predictions',
  description: 'Predict ATP & WTA tournament brackets, earn real ranking points, and compete with friends.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen" style={{ background: 'var(--chalk)', color: 'var(--ink)' }}>
        {children}
      </body>
    </html>
  )
}
