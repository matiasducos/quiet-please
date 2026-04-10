'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { sendFriendRequest } from './actions'

export default function AddFriendForm() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ username: string }[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // Debounced search
  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) {
      setResults([])
      setIsOpen(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/users?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults(data.users ?? [])
        setIsOpen(true)
        setActiveIndex(-1)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  // Outside click to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    search(val)
  }

  function selectUser(username: string) {
    setQuery(username)
    setIsOpen(false)
    setResults([])
    // Focus the input so the user can immediately submit
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      selectUser(results[activeIndex].username)
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  return (
    <div className="bg-white rounded-sm border p-6 mb-8" style={{ borderColor: 'var(--chalk-dim)' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '1rem' }}>Add a friend</h2>
      <form action={sendFriendRequest} className="flex gap-3">
        <input type="hidden" name="return_to" value="/friends" />
        <div className="flex-1 relative" ref={wrapperRef}>
          <input
            ref={inputRef}
            name="username"
            type="text"
            placeholder="Enter username"
            required
            autoComplete="off"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (results.length > 0 && query.length >= 2) setIsOpen(true) }}
            className="w-full px-3 py-2 rounded-sm border text-sm"
            style={{ borderColor: 'var(--chalk-dim)', fontFamily: 'var(--font-mono)', outline: 'none' }}
          />

          {/* Dropdown */}
          {isOpen && (
            <div
              className="absolute left-0 right-0 mt-1 bg-white border rounded-sm shadow-md overflow-hidden"
              style={{ borderColor: 'var(--chalk-dim)', zIndex: 50, maxHeight: '240px', overflowY: 'auto' }}
            >
              {loading && results.length === 0 && (
                <div className="px-3 py-2" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  Searching...
                </div>
              )}
              {!loading && results.length === 0 && query.length >= 2 && (
                <div className="px-3 py-2" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  No users found
                </div>
              )}
              {results.map((u, i) => (
                <button
                  key={u.username}
                  type="button"
                  className="w-full text-left px-3 py-2 transition-colors"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.85rem',
                    color: 'var(--ink)',
                    background: i === activeIndex ? '#edf4fc' : 'white',
                    cursor: 'pointer',
                    border: 'none',
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault() // prevent blur before click
                    selectUser(u.username)
                  }}
                >
                  {u.username}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90"
          style={{ background: 'var(--court)' }}
        >
          Send request
        </button>
      </form>
    </div>
  )
}
