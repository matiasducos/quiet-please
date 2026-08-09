import type { Metadata } from 'next'
import { DM_Serif_Display, DM_Mono, DM_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Suspense } from 'react'
import PostHogProvider from '@/components/PostHogProvider'
import ConsentBanner from '@/components/ConsentBanner'
import { SITE_URL, DEFAULT_OG } from '@/lib/site'
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
  // NO `alternates.canonical` here, and no `openGraph.url`. Metadata cascades
  // down the route tree, so a canonical on the root layout is not "the
  // homepage's canonical" — it is the default for every page that does not set
  // its own. `canonical: '/'` here had ten public URLs (/tournaments,
  // /leaderboard, /terms, /privacy, /signup, /login, /challenges/create …) all
  // declaring the homepage as their canonical. Google can see they are not
  // duplicates of the homepage, so it discarded the declaration and reported
  // "Duplicate, Google chose different canonical than user" against each one.
  //
  // Every indexable page therefore declares its own self-referencing canonical.
  //
  // `og:url` has the same problem and cannot be fixed the same way: Next
  // shallow-merges metadata, so a page setting `openGraph: { url }` replaces
  // this whole object rather than adding to it, losing the site defaults. So
  // the default carries no `url`, and each page that needs one sets a complete
  // openGraph block — the slam pages, the tournament hub and edition pages,
  // and the homepage (src/app/page.tsx), which reuses the copy below via
  // DEFAULT_OG.
  openGraph: { ...DEFAULT_OG },
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
        {/* Outside the PostHogProvider Suspense boundary: the banner governs
            what PostHog is allowed to store, so it must never be waiting on
            PostHog to render. */}
        <ConsentBanner />
        <Analytics />
      </body>
    </html>
  )
}
