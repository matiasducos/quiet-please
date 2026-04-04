'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function updateLocation(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const country  = (formData.get('country') as string)?.trim() || null
  const city     = (formData.get('city')    as string)?.trim() || null
  const username = formData.get('username') as string

  await supabase
    .from('users')
    .update({ country, city })
    .eq('id', user.id)

  revalidatePath(`/profile/${username}`)
  redirect(`/profile/${username}?msg=Location+updated&type=success`)
}

export async function toggleEmailNotifications(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const { error } = await supabase
    .from('users')
    .update({ email_notifications: enabled })
    .eq('id', user.id)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function updateUsername(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const oldUsername = (formData.get('old_username') as string)?.trim()
  const raw = (formData.get('username') as string)?.trim() ?? ''
  const clean = raw.toLowerCase().replace(/[^a-z0-9_]/g, '')

  if (clean.length < 3) return { error: 'Username must be at least 3 characters.' }
  if (clean.length > 20) return { error: 'Username must be 20 characters or fewer.' }
  if (clean === oldUsername) return { error: 'That is already your username.' }

  // Check uniqueness via admin client (bypasses RLS)
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('username', clean)
    .neq('id', user.id)
    .single()

  if (existing) return { error: 'That username is already taken.' }

  const { error } = await admin
    .from('users')
    .update({ username: clean })
    .eq('id', user.id)

  if (error) return { error: error.message }

  revalidatePath(`/profile/${oldUsername}`)
  revalidatePath(`/profile/${clean}`)
  revalidatePath('/dashboard')
  return {}
}
