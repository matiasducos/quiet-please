import type { Metadata } from 'next'

// Same reasoning as /login's layout: a thin auth page needs its own title and
// description or it reads as a duplicate of the two beside it. `noindex`
// because there is nothing here worth ranking — see robots.ts.
export const metadata: Metadata = {
  title: 'Reset Your Password',
  description: 'Send yourself a link to choose a new Quiet Please password.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/forgot-password' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
