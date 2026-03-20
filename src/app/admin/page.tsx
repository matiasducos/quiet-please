import { createClient } from '@/lib/supabase/server'
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

  return <AdminPanel />
}
