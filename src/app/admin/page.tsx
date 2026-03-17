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

  const cronSecret = process.env.CRON_SECRET ?? ''

  // Fetch tournaments for status override (2026 onwards, newest first)
  const admin = createAdminClient()
  const { data: tournaments } = await admin
    .from('tournaments')
    .select('id, name, status, start_date, tour')
    .gte('start_date', '2026-01-01')
    .order('start_date', { ascending: false })

  return <AdminPanel cronSecret={cronSecret} tournaments={tournaments ?? []} />
}
