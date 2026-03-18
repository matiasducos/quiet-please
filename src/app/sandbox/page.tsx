import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
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

  // Nav is a server component (renders NotificationBell which uses next/headers).
  // We pass it as a ReactNode prop so SandboxClient never needs to import Nav
  // directly — that would pull next/headers into the client bundle.
  const nav = (
    <Nav
      username={profile?.username}
      points={profile?.ranking_points ?? 0}
      activePage="test"
      userId={user?.id}
    />
  )

  return (
    <SandboxClient
      userId={user?.id ?? null}
      username={profile?.username ?? null}
      points={profile?.ranking_points ?? 0}
      nav={nav}
    />
  )
}
