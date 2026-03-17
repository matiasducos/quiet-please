'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function sendFriendRequest(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const username = (formData.get('username') as string)?.trim()
  const returnTo = (formData.get('return_to') as string) || '/friends'

  if (!username) redirect(`${returnTo}?msg=Please+enter+a+username&type=error`)

  const admin = createAdminClient()

  // Find target user (case-insensitive)
  const { data: target } = await admin
    .from('users')
    .select('id, username')
    .ilike('username', username)
    .single()

  if (!target) redirect(`${returnTo}?msg=User+%22${encodeURIComponent(username)}%22+not+found&type=error`)
  if (target.id === user.id) redirect(`${returnTo}?msg=You+cannot+add+yourself+as+a+friend&type=error`)

  // Check for existing friendship in either direction
  const { data: existing } = await admin
    .from('friendships')
    .select('id, status, requester_id')
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${target.id}),` +
      `and(requester_id.eq.${target.id},addressee_id.eq.${user.id})`
    )
    .maybeSingle()

  if (existing) {
    if (existing.status === 'accepted') {
      redirect(`${returnTo}?msg=You+are+already+friends+with+${encodeURIComponent(target.username)}&type=error`)
    }
    if (existing.status === 'pending' && existing.requester_id === user.id) {
      redirect(`${returnTo}?msg=Friend+request+already+sent+to+${encodeURIComponent(target.username)}&type=error`)
    }
    if (existing.status === 'pending' && existing.requester_id === target.id) {
      // They already sent us a request — auto-accept it
      await admin
        .from('friendships')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      revalidatePath('/friends')
      redirect(`${returnTo}?msg=You+are+now+friends+with+${encodeURIComponent(target.username)}&type=success`)
    }
    if (existing.status === 'declined') {
      // Remove old declined record so we can re-send
      await admin.from('friendships').delete().eq('id', existing.id)
    }
  }

  const { error } = await admin
    .from('friendships')
    .insert({ requester_id: user.id, addressee_id: target.id })

  if (error) redirect(`${returnTo}?msg=${encodeURIComponent(error.message)}&type=error`)

  revalidatePath('/friends')
  redirect(`${returnTo}?msg=Friend+request+sent+to+${encodeURIComponent(target.username)}&type=success`)
}

export async function acceptFriendRequest(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const friendshipId = formData.get('friendship_id') as string
  const returnTo = (formData.get('return_to') as string) || '/friends'
  const admin = createAdminClient()

  await admin
    .from('friendships')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', friendshipId)
    .eq('addressee_id', user.id)

  revalidatePath('/friends')
  redirect(`${returnTo}?msg=Friend+request+accepted&type=success`)
}

export async function declineFriendRequest(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const friendshipId = formData.get('friendship_id') as string
  const returnTo = (formData.get('return_to') as string) || '/friends'
  const admin = createAdminClient()

  await admin
    .from('friendships')
    .update({ status: 'declined', updated_at: new Date().toISOString() })
    .eq('id', friendshipId)
    .eq('addressee_id', user.id)

  revalidatePath('/friends')
  redirect(`${returnTo}?msg=Request+declined&type=error`)
}
