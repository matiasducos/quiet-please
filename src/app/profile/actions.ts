'use server'

import { createClient } from '@/lib/supabase/server'
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
