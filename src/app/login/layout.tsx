import type { Metadata } from 'next'

// Bare title — the root layout's `%s | Quiet Please` template supplies the suffix.
//
// The description is spelled out rather than inherited because /login and
// /signup are otherwise near-identical thin pages: same layout, same form,
// same inherited site description. Two pages that differ only in a heading are
// exactly what Google collapses into one canonical.
export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to Quiet Please to fill in your brackets, check your points and see how your friends are doing.',
  alternates: { canonical: '/login' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
