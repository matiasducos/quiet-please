import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function NotificationBell({ userId }: { userId: string }) {
  try {
    const supabase = await createClient()
    const { count } = await (supabase as any)
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null)

    if (!count) return null

    return (
      <Link
        href="/notifications"
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
        title={`${count} unread notification${count > 1 ? 's' : ''}`}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: 'var(--court)',
            display: 'block',
          }}
        />
      </Link>
    )
  } catch {
    // Notifications table may not exist yet — fail silently
    return null
  }
}
