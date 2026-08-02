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

/**
 * Admin guard for server actions. Throws rather than redirecting — an action
 * has no page to send anyone to.
 */
export async function assertAdmin() {
  if (process.env.NODE_ENV === 'development') return
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  if (!ADMIN_IDS.has(user.id)) throw new Error('Forbidden')
}
