import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

// A minimal bell SVG — reused in both the connected and fallback renders.
function BellIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <path
        d="M8.5 1.5C6.29 1.5 4.5 3.29 4.5 5.5V9.5L3 11V11.75H14V11L12.5 9.5V5.5C12.5 3.29 10.71 1.5 8.5 1.5Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 11.75V12.25C7 13.08 7.67 13.75 8.5 13.75C9.33 13.75 10 13.08 10 12.25V11.75"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default async function NotificationBell({ userId }: { userId: string }) {
  let unreadCount = 0

  try {
    const supabase = await createClient()
    const { count } = await (supabase as any)
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null)
    unreadCount = count ?? 0
  } catch {
    // Notifications table may not exist yet — render bell without badge
  }

  return (
    <Link
      href="/notifications"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        color: 'var(--ink)',
        opacity: 0.7,
      }}
      title={
        unreadCount > 0
          ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
          : 'Notifications'
      }
    >
      <BellIcon />
      {unreadCount > 0 && (
        <span
          style={{
            position:     'absolute',
            top:          '-4px',
            right:        '-4px',
            width:        '10px',
            height:       '10px',
            borderRadius: '50%',
            background:   '#e8120c',
            display:      'block',
            border:       '2px solid var(--chalk, #f5f2eb)',
          }}
          aria-label={`${unreadCount} unread`}
        />
      )}
    </Link>
  )
}
