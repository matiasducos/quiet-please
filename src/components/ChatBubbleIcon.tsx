'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

function ChatIcon() {
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
        d="M3 3.5h11a1 1 0 011 1v7a1 1 0 01-1 1H6l-3 2.5V4.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function ChatBubbleIcon({
  initialCount,
}: {
  initialCount: number
}) {
  const [unreadCount, setUnreadCount] = useState(initialCount)

  // Read the count straight from Postgres, not from a Vercel route.
  //
  // This used to fetch /api/messages/unread-count every 10 seconds, from the
  // nav, on every page: 360 serverless invocations per open tab per hour,
  // scaling with concurrent users rather than with anything a user did. At 100
  // concurrent users that single badge would have cost more Active CPU per day
  // than the plan allows per month.
  //
  // The interval was never the problem — its destination was. A request the
  // browser sends directly to Supabase never touches a Fluid function, so this
  // costs zero Active CPU no matter how often it runs. my_unread_message_count()
  // derives the user from the session, so there is no id to tamper with and RLS
  // still governs everything.
  //
  // (Realtime push would be nicer still, but private channels need an RLS policy
  // on realtime.messages, which is owned by supabase_realtime_admin and cannot be
  // altered from this project. See migration 091.)
  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      // Skip while the tab is hidden. A backgrounded tab has nobody looking at
      // the badge, and this is the difference between an idle tab costing
      // nothing and costing a query a minute for as long as it stays open.
      if (document.visibilityState !== 'visible') return

      const supabase = createClient()
      const { data, error } = await supabase.rpc('my_unread_message_count')
      if (!cancelled && !error && typeof data === 'number') setUnreadCount(data)
    }

    // Refresh when the tab comes back to the foreground — that is when a stale
    // badge is actually visible, and it makes the interval a backstop rather
    // than the main mechanism.
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    const interval = setInterval(refresh, 60_000)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      clearInterval(interval)
    }
  }, [])

  return (
    <Link
      href="/messages"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        color: 'var(--ink)',
        opacity: 0.7,
      }}
      title={
        unreadCount > 0
          ? `${unreadCount} unread message${unreadCount > 1 ? 's' : ''}`
          : 'Messages'
      }
    >
      <ChatIcon />
      {unreadCount > 0 && (
        <span
          style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#e8120c',
            display: 'block',
            border: '2px solid var(--chalk, #f5f2eb)',
          }}
          aria-label={`${unreadCount} unread`}
        />
      )}
    </Link>
  )
}
