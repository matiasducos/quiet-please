'use client'

import { useState } from 'react'
import { updateLeagueSettings, kickMember, deleteLeague } from '../actions'

const TOURNAMENT_TYPES = [
  { value: 'grand_slam', label: 'Grand Slams' },
  { value: 'masters_1000', label: 'Masters 1000' },
  { value: '500', label: '500s' },
  { value: '250', label: '250s' },
] as const

type Member = {
  user_id: string
  username: string
  total_points: number
  isOwner: boolean
}

export default function SettingsForm({
  leagueId,
  initialName,
  initialDescription,
  initialIsPublic,
  initialTournamentTypes,
  members: initialMembers,
}: {
  leagueId: string
  initialName: string
  initialDescription: string
  initialIsPublic: boolean
  initialTournamentTypes: string[] | null
  members: Member[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [isPublic, setIsPublic] = useState(initialIsPublic)
  const [selectedTypes, setSelectedTypes] = useState<string[]>(initialTournamentTypes ?? [])
  const [members, setMembers] = useState(initialMembers)
  const [kickingId, setKickingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function toggleType(val: string) {
    setSelectedTypes(prev => prev.includes(val) ? prev.filter(t => t !== val) : [...prev, val])
  }

  async function handleSave(formData: FormData) {
    setSaving(true)
    setError(null)
    formData.set('is_public', isPublic ? 'true' : 'false')
    formData.set('tournament_types', selectedTypes.join(','))
    const result = await updateLeagueSettings(leagueId, formData)
    if (result?.error) {
      setError(result.error)
      setSaving(false)
    }
  }

  async function handleKick(userId: string, username: string) {
    if (!confirm(`Remove ${username} from this league? They can rejoin later.`)) return
    setKickingId(userId)
    const result = await kickMember(leagueId, userId)
    if (result?.error) {
      alert(result.error)
    } else {
      setMembers(prev => prev.filter(m => m.user_id !== userId))
    }
    setKickingId(null)
  }

  async function handleDelete() {
    const msg = members.length > 1
      ? `This will permanently delete the league and remove all ${members.length} members. This cannot be undone.`
      : 'This will permanently delete the league. This cannot be undone.'
    if (!confirm(msg)) return
    setDeleting(true)
    const result = await deleteLeague(leagueId)
    if (result?.error) {
      alert(result.error)
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* League settings form */}
      <form action={handleSave} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>LEAGUE NAME</label>
          <input
            name="name"
            type="text"
            required
            maxLength={50}
            defaultValue={initialName}
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
            defaultValue={initialDescription}
            placeholder="What's this league about?"
            className="w-full px-4 py-3 rounded-sm text-sm outline-none"
            style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
            onFocus={e => e.target.style.borderColor = 'var(--court)'}
            onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'}
          />
        </div>

        {/* Visibility */}
        <div className="flex flex-col gap-1.5">
          <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>VISIBILITY</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsPublic(false)}
              className="flex-1 px-4 py-2.5 rounded-sm text-sm transition-colors"
              style={{
                background: !isPublic ? 'var(--court)' : 'white',
                color: !isPublic ? 'white' : 'var(--ink)',
                border: `1.5px solid ${!isPublic ? 'var(--court)' : 'var(--chalk-dim)'}`,
              }}
            >
              🔒 Private
            </button>
            <button
              type="button"
              onClick={() => setIsPublic(true)}
              className="flex-1 px-4 py-2.5 rounded-sm text-sm transition-colors"
              style={{
                background: isPublic ? 'var(--court)' : 'white',
                color: isPublic ? 'white' : 'var(--ink)',
                border: `1.5px solid ${isPublic ? 'var(--court)' : 'var(--chalk-dim)'}`,
              }}
            >
              🌐 Public
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '2px' }}>
            {isPublic ? 'Anyone can find and join this league.' : 'Only people with the invite code can join.'}
          </p>
        </div>

        {/* Tournament types */}
        <div className="flex flex-col gap-1.5">
          <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
            TOURNAMENTS <span style={{ opacity: 0.5 }}>(optional filter)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {TOURNAMENT_TYPES.map(t => {
              const active = selectedTypes.includes(t.value)
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => toggleType(t.value)}
                  className="px-3 py-1.5 rounded-sm text-sm transition-colors"
                  style={{
                    background: active ? '#1e4e8c' : 'white',
                    color: active ? 'white' : 'var(--ink)',
                    border: `1.5px solid ${active ? '#1e4e8c' : 'var(--chalk-dim)'}`,
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '2px' }}>
            {selectedTypes.length === 0
              ? 'All tournament types count toward standings.'
              : `Only ${selectedTypes.length} selected type${selectedTypes.length > 1 ? 's' : ''} will count. Changes apply going forward.`}
          </p>
        </div>

        {error && (
          <p className="text-sm px-3 py-2 rounded-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50 mt-1"
          style={{ background: 'var(--court)' }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      {/* Members management */}
      <div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.75rem' }}>Members</h2>
        <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
          {members.map(m => (
            <div
              key={m.user_id}
              className="flex items-center justify-between px-5 py-3 border-b last:border-0"
              style={{ borderColor: 'var(--chalk-dim)' }}
            >
              <div className="flex items-center gap-2">
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem' }}>{m.username}</span>
                {m.isOwner && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', background: 'var(--chalk-dim)', padding: '1px 6px', borderRadius: '2px' }}>you</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{m.total_points} pts</span>
                {!m.isOwner && (
                  <button
                    onClick={() => handleKick(m.user_id, m.username)}
                    disabled={kickingId === m.user_id}
                    className="px-2 py-0.5 rounded-sm text-xs transition-colors hover:opacity-80 disabled:opacity-40"
                    style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca' }}
                  >
                    {kickingId === m.user_id ? '…' : 'Remove'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <div className="pt-6" style={{ borderTop: '1px solid var(--chalk-dim)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: '#b91c1c', marginBottom: '0.5rem' }}>Danger zone</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '1rem' }}>
          Deleting a league removes all members and cannot be undone.
        </p>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="px-4 py-2 text-sm rounded-sm border transition-colors hover:opacity-80 disabled:opacity-40"
          style={{ color: '#b91c1c', borderColor: '#fecaca', background: '#fef2f2' }}
        >
          {deleting ? 'Deleting…' : 'Delete league'}
        </button>
      </div>
    </div>
  )
}
