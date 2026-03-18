import { createClient } from '@/lib/supabase/server'
import SandboxClient from './SandboxClient'

export default async function SandboxPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const profile = user
    ? await supabase
        .from('users')
        .select('username, ranking_points')
        .eq('id', user.id)
        .single()
        .then(r => r.data)
    : null

  return (
    <SandboxClient
      userId={user?.id ?? null}
      username={profile?.username ?? null}
      points={profile?.ranking_points ?? 0}
    />
  )
}
