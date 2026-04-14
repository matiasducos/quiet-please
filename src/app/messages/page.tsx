import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import ConversationList from './ConversationList'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Messages | Quiet Please',
}

export default async function MessagesPage() {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} userId={user.id} />

      <div className="max-w-2xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-8">
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2rem',
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
            }}
          >
            Messages
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
            Chat with your friends.
          </p>
        </div>

        <ConversationList userId={user.id} />
      </div>
    </main>
  )
}
