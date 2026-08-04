import type { Metadata } from 'next'

// Bare title — the root layout's `%s | Quiet Please` template supplies the suffix.
export const metadata: Metadata = { title: 'Sign In' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
