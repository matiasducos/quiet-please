import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/** Server-side admin guard for admin sub-route page.tsx files. */
export async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const isDev = process.env.NODE_ENV === 'development'
  const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const isAdmin = isDev || adminIds.includes(user.id)
  if (!isAdmin) redirect('/dashboard')

  return user
}
