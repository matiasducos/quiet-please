import type { Metadata } from 'next'

// Bare title — the root layout's `%s | Quiet Please` template supplies the
// suffix. Spelling it out here produced "Sign Up | Quiet Please | Quiet Please".
export const metadata: Metadata = { title: 'Sign Up' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
