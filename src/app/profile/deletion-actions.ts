'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

/**
 * Request account deletion — sets deletion_requested_at = now().
 * Requires the user to type their username correctly as confirmation.
 * The actual deletion happens 7 days later via the process-deletions cron.
 */
export async function requestAccountDeletion(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const confirmUsername = (formData.get('confirm_username') as string)?.trim()
  if (!confirmUsername) return { error: 'Please type your username to confirm.' }

  // Fetch the user's actual username
  const admin = createAdminClient()
  const { data: profile, error: profileErr } = await admin
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile) return { error: 'Could not verify your identity.' }

  if (confirmUsername !== profile.username) {
    return { error: 'Username does not match. Please type your exact username.' }
  }

  // Set the deletion timestamp
  const { error } = await admin
    .from('users')
    .update({ deletion_requested_at: new Date().toISOString() })
    .eq('id', user.id)

  if (error) return { error: 'Something went wrong. Please try again.' }

  revalidatePath(`/profile/${profile.username}`)
  return { success: true }
}

/**
 * Cancel a pending account deletion — clears deletion_requested_at.
 */
export async function cancelAccountDeletion() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single()

  const { error } = await admin
    .from('users')
    .update({ deletion_requested_at: null })
    .eq('id', user.id)

  if (error) return { error: 'Something went wrong. Please try again.' }

  revalidatePath(`/profile/${profile?.username ?? ''}`)
  return { success: true }
}
