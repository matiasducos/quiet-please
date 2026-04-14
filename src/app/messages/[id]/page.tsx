import { getNavProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import ChatView from './ChatView'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Chat | Quiet Please',
}

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: conversationId } = await params
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  // Fetch conversation + friend info server-side for header
  const supabase = await createClient()
  const { data: convo, error } = await supabase
    .from('conversations')
    .select('id, user1_id, user2_id')
    .eq('id', conversationId)
    .maybeSingle()

  if (error || !convo) redirect('/messages')

  const friendId = convo.user1_id === user.id ? convo.user2_id : convo.user1_id

  const { data: friendProfile } = await supabase
    .from('users')
    .select('username')
    .eq('id', friendId)
    .single()

  if (!friendProfile) redirect('/messages')

  return (
    <main className="min-h-screen flex flex-col" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} userId={user.id} />

      <ChatView
        conversationId={conversationId}
        userId={user.id}
        friendUsername={friendProfile.username}
      />
    </main>
  )
}
