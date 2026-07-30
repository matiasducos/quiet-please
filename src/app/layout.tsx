import type { Metadata } from 'next'
import { DM_Serif_Display, DM_Mono, DM_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Suspense } from 'react'
import PostHogProvider from '@/components/PostHogProvider'
import { SITE_URL, SITE_NAME } from '@/lib/site'
import './globals.css'

const dmSerifDisplay = DM_Serif_Display({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display-face',
})

const dmMono = DM_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono-face',
})

const dmSans = DM_Sans({
  weight: ['300', '400', '500'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body-face',
})

import type { Viewport } from 'next'

// Search positioning: "tennis bracket challenge" is the category term, and the
// sites ranking for it are small independents rather than media giants. We
// deliberately do NOT target "tennis predictions" (owned by betting/tipster
// sites — wrong intent, wrong audience) or "fantasy tennis" (a draft/roster
// game, which is not what this is).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Free Tennis Bracket Challenge — ATP & WTA | Quiet Please',
    template: '%s | Quiet Please',
  },
  description:
    'Fill out the bracket for any ATP or WTA tournament, earn points for every correct pick, and compete with friends across the full season. Free to play.',
  keywords: [
    'tennis bracket challenge',
    'tennis bracket predictions',
    'ATP bracket',
    'WTA bracket',
    'tennis pick em',
    'tennis draw predictions',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: '/',
    title: 'Free Tennis Bracket Challenge — ATP & WTA',
    description:
      'Fill out the bracket for any ATP or WTA tournament, earn points for every correct pick, and compete with friends across the full season.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Free Tennis Bracket Challenge — ATP & WTA',
    description:
      'Fill out the bracket for any ATP or WTA tournament, earn points for every correct pick, and compete with friends across the full season.',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Quiet Please',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // maximumScale/userScalable are deliberately unset: pinning them blocks
  // pinch-zoom, which fails WCAG 1.4.4 and hurts anyone who needs to magnify.
  themeColor: '#1a6b3c',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSerifDisplay.variable} ${dmMono.variable} ${dmSans.variable}`} suppressHydrationWarning>
      <body className="min-h-screen" style={{ background: 'var(--chalk)', color: 'var(--ink)' }}>
        <Suspense fallback={null}>
          <PostHogProvider>
            {children}
          </PostHogProvider>
        </Suspense>
        <Analytics />
      </body>
    </html>
  )
}
