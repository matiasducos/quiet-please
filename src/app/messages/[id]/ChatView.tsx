'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import MessageInput from './MessageInput'

type Message = {
  id: string
  senderId: string
  body: string
  readAt: string | null
  createdAt: string
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

function shouldShowDateSeparator(current: Message, prev: Message | null) {
  if (!prev) return true
  const a = new Date(prev.createdAt).toDateString()
  const b = new Date(current.createdAt).toDateString()
  return a !== b
}

export default function ChatView({
  conversationId,
  userId,
  friendUsername,
}: {
  conversationId: string
  userId: string
  friendUsername: string
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastTimestampRef = useRef<string | null>(null)
  const isInitialLoadRef = useRef(true)

  // Scroll to bottom
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    bottomRef.current?.scrollIntoView({ behavior })
  }, [])

  // Initial fetch
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/messages/conversations/${conversationId}?limit=50`)
        if (!res.ok) { setLoadError(true); return }
        const data = await res.json()
        setMessages(data.messages ?? [])
        setHasMore(data.hasMore ?? false)

        const msgs = data.messages ?? []
        if (msgs.length > 0) {
          lastTimestampRef.current = msgs[msgs.length - 1].createdAt
        }

        // Mark as read
        fetch('/api/messages/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId }),
        })
      } catch {
        setLoadError(true)
      } finally {
        setLoading(false)
        isInitialLoadRef.current = true
      }
    }
    load()
  }, [conversationId])

  // Scroll to bottom after initial load
  useEffect(() => {
    if (!loading && isInitialLoadRef.current) {
      isInitialLoadRef.current = false
      // Small delay to ensure DOM has rendered
      requestAnimationFrame(() => scrollToBottom())
    }
  }, [loading, scrollToBottom])

  // Poll for new messages every 10s
  useEffect(() => {
    if (loading) return

    const poll = async () => {
      if (!lastTimestampRef.current) return
      try {
        const res = await fetch(
          `/api/messages/conversations/${conversationId}?after=${encodeURIComponent(lastTimestampRef.current)}`
        )
        if (!res.ok) return
        const data = await res.json()
        const newMsgs: Message[] = data.messages ?? []
        if (newMsgs.length > 0) {
          setMessages(prev => [...prev, ...newMsgs])
          lastTimestampRef.current = newMsgs[newMsgs.length - 1].createdAt

          // Mark as read
          fetch('/api/messages/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId }),
          })

          // Scroll to bottom for new messages
          requestAnimationFrame(() => scrollToBottom('smooth'))
        }
      } catch {
        // Swallow
      }
    }

    const interval = setInterval(poll, 10_000)
    return () => clearInterval(interval)
  }, [conversationId, loading, scrollToBottom])

  // Load older messages
  const loadMore = async () => {
    if (loadingMore || messages.length === 0) return
    setLoadingMore(true)
    const oldestTimestamp = messages[0].createdAt
    const container = containerRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0

    try {
      const res = await fetch(
        `/api/messages/conversations/${conversationId}?before=${encodeURIComponent(oldestTimestamp)}&limit=50`
      )
      if (!res.ok) return
      const data = await res.json()
      const olderMsgs: Message[] = data.messages ?? []
      if (olderMsgs.length > 0) {
        setMessages(prev => [...olderMsgs, ...prev])
        setHasMore(data.hasMore ?? false)

        // Preserve scroll position after prepending
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop = container.scrollHeight - prevScrollHeight
          }
        })
      } else {
        setHasMore(false)
      }
    } catch {
      // Swallow
    } finally {
      setLoadingMore(false)
    }
  }

  // Handle new message sent by user
  const handleMessageSent = (msg: Message) => {
    setMessages(prev => [...prev, msg])
    lastTimestampRef.current = msg.createdAt
    requestAnimationFrame(() => scrollToBottom('smooth'))
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Loading...</p>
      </div>
    )
  }

  if (loadError && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
          Could not load messages. Please try again later.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full">
      {/* Chat header */}
      <div
        className="flex items-center gap-3 px-4 md:px-8 py-3 border-b bg-white"
        style={{ borderColor: 'var(--chalk-dim)' }}
      >
        <Link
          href="/messages"
          style={{ color: 'var(--muted)', fontSize: '1.2rem', textDecoration: 'none', lineHeight: 1 }}
          title="Back to messages"
        >
          ←
        </Link>
        <Link
          href={`/profile/${friendUsername}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.9rem',
            color: 'var(--ink)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          {friendUsername}
        </Link>
      </div>

      {/* Messages container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 md:px-8 py-4"
        style={{ minHeight: 0 }}
      >
        {/* Load more button */}
        {hasMore && (
          <div className="text-center mb-4">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem',
                color: 'var(--court)',
                background: 'none',
                border: 'none',
                cursor: loadingMore ? 'default' : 'pointer',
                opacity: loadingMore ? 0.5 : 1,
                letterSpacing: '0.03em',
              }}
            >
              {loadingMore ? 'Loading...' : 'Load older messages'}
            </button>
          </div>
        )}

        {/* Empty state */}
        {messages.length === 0 && (
          <div className="text-center py-16">
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              No messages yet. Say hello to {friendUsername}!
            </p>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, i) => {
          const isOwn = msg.senderId === userId
          const showDate = shouldShowDateSeparator(msg, i > 0 ? messages[i - 1] : null)

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="text-center my-4">
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.65rem',
                      color: 'var(--muted)',
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {formatDate(msg.createdAt)}
                  </span>
                </div>
              )}
              <div
                className={`flex mb-2 ${isOwn ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  style={{
                    maxWidth: '75%',
                    padding: '8px 12px',
                    borderRadius: isOwn ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    background: isOwn ? 'var(--court)' : 'white',
                    color: isOwn ? 'white' : 'var(--ink)',
                    border: isOwn ? 'none' : '1px solid var(--chalk-dim)',
                    wordBreak: 'break-word',
                  }}
                >
                  <p style={{ fontSize: '0.875rem', lineHeight: 1.45, margin: 0, whiteSpace: 'pre-wrap' }}>
                    {msg.body}
                  </p>
                  <p
                    style={{
                      fontSize: '0.6rem',
                      color: isOwn ? 'rgba(255,255,255,0.7)' : 'var(--muted)',
                      marginTop: '4px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {formatTime(msg.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          )
        })}

        {/* Invisible scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Message input */}
      <MessageInput
        conversationId={conversationId}
        onMessageSent={handleMessageSent}
      />
    </div>
  )
}
