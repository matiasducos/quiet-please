#!/bin/bash
set -e

# Server action for creating a league
mkdir -p "src/app/leagues/new"
cat > "src/app/leagues/new/actions.ts" << 'EOF'
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function createLeague(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const name = formData.get('name') as string
  const description = formData.get('description') as string

  if (!name?.trim()) return { error: 'League name is required' }

  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .insert({ name: name.trim(), description: description?.trim() || null, owner_id: user.id })
    .select()
    .single()

  if (leagueError) return { error: leagueError.message }

  // Auto-join as member
  await supabase
    .from('league_members')
    .insert({ league_id: league.id, user_id: user.id })

  redirect(`/leagues/${league.id}`)
}
EOF

# Rewrite the new league page to use server action
cat > "src/app/leagues/new/page.tsx" << 'EOF'
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createLeague } from './actions'

export default function NewLeaguePage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await createLeague(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-8" style={{ background: 'var(--chalk)' }}>
      <div className="w-full max-w-md">
        <Link href="/leagues" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>← Back to leagues</Link>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', margin: '1.5rem 0 0.5rem' }}>
          Create a league
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Invite friends with a shareable code after creating.
        </p>

        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>LEAGUE NAME</label>
            <input
              name="name"
              type="text"
              required
              maxLength={50}
              placeholder="e.g. The Federer Fan Club"
              className="w-full px-4 py-3 rounded-sm text-sm outline-none"
              style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
              onFocus={e => e.target.style.borderColor = 'var(--court)'}
              onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
              DESCRIPTION <span style={{ opacity: 0.5 }}>(optional)</span>
            </label>
            <input
              name="description"
              type="text"
              maxLength={120}
              placeholder="What's this league about?"
              className="w-full px-4 py-3 rounded-sm text-sm outline-none"
              style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
              onFocus={e => e.target.style.borderColor = 'var(--court)'}
              onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'}
            />
          </div>

          {error && (
            <p className="text-sm px-3 py-2 rounded-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50 mt-1"
            style={{ background: 'var(--court)' }}
          >
            {loading ? 'Creating…' : 'Create league'}
          </button>
        </form>
      </div>
    </main>
  )
}
EOF

# Server action for joining a league
cat > "src/app/leagues/join/actions.ts" << 'EOF'
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function joinLeague(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const code = (formData.get('code') as string)?.toUpperCase().trim()
  if (!code) return { error: 'Please enter an invite code' }

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name')
    .eq('invite_code', code)
    .eq('is_active', true)
    .single()

  if (!league) return { error: 'Invalid invite code. Check the code and try again.' }

  // Check if already a member
  const { data: existing } = await supabase
    .from('league_members')
    .select('league_id')
    .eq('league_id', league.id)
    .eq('user_id', user.id)
    .single()

  if (existing) redirect(`/leagues/${league.id}`)

  const { error: joinError } = await supabase
    .from('league_members')
    .insert({ league_id: league.id, user_id: user.id })

  if (joinError) return { error: joinError.message }

  redirect(`/leagues/${league.id}`)
}
EOF

# Rewrite join page to use server action
cat > "src/app/leagues/join/page.tsx" << 'EOF'
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { joinLeague } from './actions'

export default function JoinLeaguePage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await joinLeague(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-8" style={{ background: 'var(--chalk)' }}>
      <div className="w-full max-w-md">
        <Link href="/leagues" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>← Back to leagues</Link>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', margin: '1.5rem 0 0.5rem' }}>
          Join a league
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Enter the invite code shared by the league owner.
        </p>

        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>INVITE CODE</label>
            <input
              name="code"
              type="text"
              required
              maxLength={8}
              placeholder="e.g. A3F8B2C1"
              className="w-full px-4 py-3 rounded-sm text-sm outline-none"
              style={{ background: 'white', border: '1.5px solid var(--chalk-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', fontSize: '1.1rem' }}
              onFocus={e => e.target.style.borderColor = 'var(--court)'}
              onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'}
            />
          </div>

          {error && (
            <p className="text-sm px-3 py-2 rounded-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50 mt-1"
            style={{ background: 'var(--court)' }}
          >
            {loading ? 'Joining…' : 'Join league'}
          </button>
        </form>
      </div>
    </main>
  )
}
EOF

echo "✅ League server actions written"
