import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/** Parsed once per cold start, not per request. */
export const ADMIN_IDS = new Set(
  (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean),
)

/** Server-side admin guard for admin sub-route page.tsx files. */
export async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const isDev = process.env.NODE_ENV === 'development'
  const isAdmin = isDev || ADMIN_IDS.has(user.id)
  if (!isAdmin) redirect('/dashboard')

  return user
}

/** Who performed an admin action, for the audit trail. */
export interface AdminActor {
  /** null only in dev, where the guard passes without a session. */
  id: string | null
  /** Always human-readable — an email, or 'dev' when running unauthenticated. */
  label: string
}

/**
 * Admin guard for server actions. Throws rather than redirecting — an action
 * has no page to send anyone to.
 *
 * Returns the acting admin so callers can attribute what they do to a person.
 * Existing callers that ignore the return value are unaffected.
 */
export async function assertAdmin(): Promise<AdminActor> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (process.env.NODE_ENV === 'development') {
    // Dev bypasses the guard, but still attributes the action when there is a
    // session to attribute it to — otherwise local testing would write audit
    // rows indistinguishable from production ones.
    return user ? { id: user.id, label: user.email ?? user.id } : { id: null, label: 'dev' }
  }

  if (!user) throw new Error('Unauthorized')
  if (!ADMIN_IDS.has(user.id)) throw new Error('Forbidden')
  return { id: user.id, label: user.email ?? user.id }
}
