'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { rateLimit } from '@/lib/rate-limit'

export async function setUsername(username: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const rl = rateLimit(`set-username:${user.id}`, { maxRequests: 5, windowMs: 60_000 })
  if (rl.limited) return { error: `Too many attempts. Try again in ${rl.retryAfter}s.` }

  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (clean.length < 3) return { error: 'Username must be at least 3 characters.' }
  if (clean.length > 20) return { error: 'Username must be 20 characters or fewer.' }

  // Check uniqueness (admin client bypasses RLS)
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
    .update({ username: clean, username_is_set: true })
    .eq('id', user.id)

  if (error) return { error: error.message }

  revalidatePath('/dashboard')
  return {}
}
