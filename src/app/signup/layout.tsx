import type { Metadata } from 'next'

// Bare title — the root layout's `%s | Quiet Please` template supplies the
// suffix. Spelling it out here produced "Sign Up | Quiet Please | Quiet Please".
// See the note in ../login/layout.tsx for why the description is spelled out.
export const metadata: Metadata = {
  title: 'Sign Up',
  description: 'Create a free Quiet Please account and start predicting ATP and WTA draws. No cost, no ads, no betting.',
  alternates: { canonical: '/signup' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
