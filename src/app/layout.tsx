import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Quiet Please — Tennis Bracket Predictions',
  description: 'Predict ATP & WTA tournament brackets, earn real ranking points, and compete with friends.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen" style={{ background: 'var(--chalk)', color: 'var(--ink)' }}>
        {children}
      </body>
    </html>
  )
}
