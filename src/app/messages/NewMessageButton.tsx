'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

type Friend = { id: string; username: string }

/**
 * "New message" button with an inline dropdown friend picker.
 * Fetches accepted friends on open, filters out those already in conversations,
 * and creates/navigates to a conversation on selection.
 */
export default function NewMessageButton({
  existingFriendIds,
}: {
  existingFriendIds: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [friends, setFriends] = useState<Friend[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Fetch friends when dropdown opens
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setSearch('')
    fetch('/api/messages/friends')
      .then(r => r.ok ? r.json() : { friends: [] })
      .then(data => setFriends(data.friends ?? []))
      .catch(() => setFriends([]))
      .finally(() => {
        setLoading(false)
        // Focus search input after loading
        setTimeout(() => inputRef.current?.focus(), 50)
      })
  }, [open])

  const handleSelect = async (friendId: string) => {
    if (creating) return
    setCreating(friendId)

    try {
      const res = await fetch('/api/messages/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.conversationId) {
        router.push(`/messages/${data.conversationId}`)
      }
    } catch {
      // Stay on page
    } finally {
      setCreating(null)
      setOpen(false)
    }
  }

  // Filter: exclude friends who already have conversations, and apply search
  const existingSet = new Set(existingFriendIds)
  const availableFriends = friends.filter(f =>
    !existingSet.has(f.id) &&
    f.username.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90 transition-opacity"
        style={{ background: 'var(--court)' }}
      >
        + New message
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 bg-white rounded-sm border shadow-lg z-50"
          style={{
            borderColor: 'var(--chalk-dim)',
            width: '260px',
            maxHeight: '320px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Search input */}
          <div className="p-2 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search friends..."
              className="w-full px-3 py-1.5 text-sm rounded-sm border"
              style={{
                borderColor: 'var(--chalk-dim)',
                fontFamily: 'var(--font-mono)',
                outline: 'none',
                fontSize: '0.8rem',
              }}
            />
          </div>

          {/* Friend list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <div className="px-4 py-6 text-center">
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Loading...</span>
              </div>
            ) : availableFriends.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  {friends.length === 0
                    ? 'No friends yet'
                    : search
                      ? 'No matches'
                      : 'All friends have conversations'}
                </span>
              </div>
            ) : (
              availableFriends.map(friend => (
                <button
                  key={friend.id}
                  onClick={() => handleSelect(friend.id)}
                  disabled={creating === friend.id}
                  className="w-full text-left px-4 py-3 border-b last:border-0 hover:bg-gray-50 transition-colors"
                  style={{
                    borderColor: 'var(--chalk-dim)',
                    cursor: creating === friend.id ? 'default' : 'pointer',
                    opacity: creating === friend.id ? 0.5 : 1,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.85rem',
                      color: 'var(--ink)',
                    }}
                  >
                    {creating === friend.id ? `Opening...` : friend.username}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
