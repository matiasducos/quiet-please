'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import LeagueChatInput from './LeagueChatInput'

type Message = {
  id: string
  senderId: string
  senderUsername: string
  body: string
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
  return new Date(prev.createdAt).toDateString() !== new Date(current.createdAt).toDateString()
}

function shouldShowSender(current: Message, prev: Message | null) {
  if (!prev) return true
  if (current.senderId !== prev.senderId) return true
  // Show sender again if >5 min gap between messages
  const gap = new Date(current.createdAt).getTime() - new Date(prev.createdAt).getTime()
  return gap > 5 * 60 * 1000
}

export default function LeagueChat({
  leagueId,
  userId,
}: {
  leagueId: string
  userId: string
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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    bottomRef.current?.scrollIntoView({ behavior })
  }, [])

  // Initial fetch
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/leagues/${leagueId}/messages?limit=50`)
        if (!res.ok) { setLoadError(true); return }
        const data = await res.json()
        setMessages(data.messages ?? [])
        setHasMore(data.hasMore ?? false)

        const msgs = data.messages ?? []
        if (msgs.length > 0) {
          lastTimestampRef.current = msgs[msgs.length - 1].createdAt
        }
      } catch {
        setLoadError(true)
      } finally {
        setLoading(false)
        isInitialLoadRef.current = true
      }
    }
    load()
  }, [leagueId])

  // Scroll to bottom after initial load
  useEffect(() => {
    if (!loading && isInitialLoadRef.current) {
      isInitialLoadRef.current = false
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
          `/api/leagues/${leagueId}/messages?after=${encodeURIComponent(lastTimestampRef.current)}`
        )
        if (!res.ok) return
        const data = await res.json()
        const newMsgs: Message[] = data.messages ?? []
        if (newMsgs.length > 0) {
          setMessages(prev => [...prev, ...newMsgs])
          lastTimestampRef.current = newMsgs[newMsgs.length - 1].createdAt
          requestAnimationFrame(() => scrollToBottom('smooth'))
        }
      } catch {
        // Swallow
      }
    }

    const interval = setInterval(poll, 10_000)
    return () => clearInterval(interval)
  }, [leagueId, loading, scrollToBottom])

  // Load older messages
  const loadMore = async () => {
    if (loadingMore || messages.length === 0) return
    setLoadingMore(true)
    const oldestTimestamp = messages[0].createdAt
    const container = containerRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0

    try {
      const res = await fetch(
        `/api/leagues/${leagueId}/messages?before=${encodeURIComponent(oldestTimestamp)}&limit=50`
      )
      if (!res.ok) return
      const data = await res.json()
      const olderMsgs: Message[] = data.messages ?? []
      if (olderMsgs.length > 0) {
        setMessages(prev => [...olderMsgs, ...prev])
        setHasMore(data.hasMore ?? false)

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

  const handleMessageSent = (msg: Message) => {
    setMessages(prev => [...prev, msg])
    lastTimestampRef.current = msg.createdAt
    requestAnimationFrame(() => scrollToBottom('smooth'))
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Loading chat...</p>
      </div>
    )
  }

  if (loadError && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
          Could not load messages. Please try again later.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)', height: 'min(600px, 70vh)' }}>
      {/* Messages container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ minHeight: 0 }}
      >
        {/* Load more */}
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
            <div style={{ fontSize: '2rem', marginBottom: '12px', opacity: 0.4 }}>💬</div>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              No messages yet. Start the conversation!
            </p>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, i) => {
          const isOwn = msg.senderId === userId
          const prev = i > 0 ? messages[i - 1] : null
          const showDate = shouldShowDateSeparator(msg, prev)
          const showSender = shouldShowSender(msg, showDate ? null : prev)

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
                className={`flex ${showSender && !isOwn ? 'mt-3' : 'mt-0.5'} ${isOwn ? 'justify-end' : 'justify-start'}`}
              >
                <div style={{ maxWidth: '75%' }}>
                  {/* Sender name for group context */}
                  {showSender && !isOwn && (
                    <Link
                      href={`/profile/${msg.senderUsername}`}
                      style={{
                        display: 'block',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.68rem',
                        fontWeight: 500,
                        color: 'var(--court)',
                        marginBottom: '2px',
                        marginLeft: '4px',
                        textDecoration: 'none',
                      }}
                    >
                      {msg.senderUsername}
                    </Link>
                  )}
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: isOwn ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: isOwn ? 'var(--court)' : 'var(--chalk)',
                      color: isOwn ? 'white' : 'var(--ink)',
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
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <LeagueChatInput
        leagueId={leagueId}
        onMessageSent={handleMessageSent}
      />
    </div>
  )
}
