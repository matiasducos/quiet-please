import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import AdminPanel from './AdminPanel'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Allow in dev always; in prod check ADMIN_USER_IDS env var
  const isDev = process.env.NODE_ENV === 'development'
  const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const isAdmin = isDev || adminIds.includes(user.id)

  if (!isAdmin) redirect('/dashboard')

  const admin = createAdminClient()
  // Show all non-completed tournaments (need manual edits) + most-recent completed ones
  const { data: tournaments } = await admin
    .from('tournaments')
    .select('id, name, status, starts_at, ends_at, draw_close_at, surface, tour')
    .order('starts_at', { ascending: true })

  return <AdminPanel tournaments={tournaments ?? []} />
}
