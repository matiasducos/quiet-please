'use client'

import { useState } from 'react'
import { updateLeagueSettings } from './actions'

const TOURNAMENT_TYPES = [
  { value: 'grand_slam', label: 'Grand Slams' },
  { value: 'masters_1000', label: 'Masters 1000' },
  { value: '500', label: '500s' },
  { value: '250', label: '250s' },
] as const

export default function TournamentSettings({ leagueId, current }: { leagueId: string; current: string[] | null }) {
  const [selectedTypes, setSelectedTypes] = useState<string[]>(current ?? [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function toggleType(val: string) {
    setSelectedTypes(prev => prev.includes(val) ? prev.filter(t => t !== val) : [...prev, val])
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    const fd = new FormData()
    fd.set('tournament_types', selectedTypes.join(','))
    const result = await updateLeagueSettings(leagueId, fd)
    setSaving(false)
    if (result?.error) alert(result.error)
    else setSaved(true)
  }

  // Check if there are unsaved changes
  const currentSet = new Set(current ?? [])
  const selectedSet = new Set(selectedTypes)
  const hasChanges = currentSet.size !== selectedSet.size || [...currentSet].some(t => !selectedSet.has(t))

  return (
    <div className="mt-6 px-5 py-4 bg-white rounded-sm border" style={{ borderColor: 'var(--chalk-dim)' }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', marginBottom: '0.75rem' }}>Tournament Filter</h3>
      <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
        Choose which tournament types count toward this league. Changes apply going forward.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
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
      <div className="flex items-center gap-3">
        <p style={{ fontSize: '0.75rem', color: 'var(--muted)', flex: 1 }}>
          {selectedTypes.length === 0 ? 'All types count.' : `${selectedTypes.length} type${selectedTypes.length > 1 ? 's' : ''} selected.`}
        </p>
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--court)' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {saved && !hasChanges && (
          <span style={{ fontSize: '0.75rem', color: 'var(--court)' }}>Saved ✓</span>
        )}
      </div>
    </div>
  )
}
