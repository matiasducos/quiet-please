'use client'

import { useState } from 'react'
import { bootstrapPlayerMapping, savePlayerMappings } from '../actions'

interface MappingCandidate {
  apiTennisId: string
  apiTennisName: string
  apiTennisCountry: string
  dsgPlayerId: string
  dsgName: string
  dsgCountry: string
  score: number
  method: 'exact' | 'fuzzy'
}

type AsyncStatus = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string }

function confidenceTier(score: number): { label: string; color: string; bg: string } {
  if (score >= 0.95) return { label: 'Exact', color: '#166534', bg: '#dcfce7' }
  if (score >= 0.85) return { label: 'High', color: '#92400e', bg: '#fef3c7' }
  return { label: 'Review', color: '#991b1b', bg: '#fee2e2' }
}

export default function PlayerMappingTable() {
  const [candidates, setCandidates] = useState<MappingCandidate[]>([])
  const [verified, setVerified] = useState<Record<string, boolean>>({}) // apiTennisId -> verified
  const [bootstrapStatus, setBootstrapStatus] = useState<AsyncStatus>({ type: 'idle' })
  const [saveStatus, setSaveStatus] = useState<AsyncStatus>({ type: 'idle' })
  const [filter, setFilter] = useState<'all' | 'exact' | 'high' | 'review'>('all')
  const [search, setSearch] = useState('')

  async function handleBootstrap() {
    setBootstrapStatus({ type: 'loading', message: 'Fetching players from both APIs...' })
    try {
      const result = await bootstrapPlayerMapping()
      if (result.ok && result.candidates) {
        setCandidates(result.candidates)
        // Auto-verify high-confidence matches
        const autoVerified: Record<string, boolean> = {}
        for (const c of result.candidates) {
          autoVerified[c.apiTennisId] = c.score >= 0.95
        }
        setVerified(autoVerified)
        setBootstrapStatus({
          type: 'success',
          message: `Found ${result.candidates.length} player matches. ${result.candidates.filter(c => c.score >= 0.95).length} auto-verified.`,
        })
      } else {
        setBootstrapStatus({ type: 'error', message: result.error ?? 'Failed to bootstrap mapping' })
      }
    } catch (err) {
      setBootstrapStatus({ type: 'error', message: String(err) })
    }
  }

  async function handleSave() {
    const mappingsToSave = candidates
      .filter(c => verified[c.apiTennisId])
      .map(c => ({
        apiTennisId: c.apiTennisId,
        dsgPlayerId: c.dsgPlayerId,
        playerName: c.apiTennisName,
        country: c.apiTennisCountry,
        matchMethod: c.method,
        matchScore: c.score,
      }))

    if (!mappingsToSave.length) {
      setSaveStatus({ type: 'error', message: 'No mappings to save. Verify at least one mapping.' })
      return
    }

    setSaveStatus({ type: 'loading', message: `Saving ${mappingsToSave.length} mappings...` })
    try {
      const result = await savePlayerMappings(mappingsToSave)
      if (result.ok) {
        setSaveStatus({ type: 'success', message: `Saved ${mappingsToSave.length} verified mappings.` })
      } else {
        setSaveStatus({ type: 'error', message: result.error ?? 'Failed to save mappings' })
      }
    } catch (err) {
      setSaveStatus({ type: 'error', message: String(err) })
    }
  }

  function toggleVerified(apiTennisId: string) {
    setVerified(prev => ({ ...prev, [apiTennisId]: !prev[apiTennisId] }))
  }

  function toggleAll(checked: boolean) {
    const next: Record<string, boolean> = {}
    for (const c of filteredCandidates) {
      next[c.apiTennisId] = checked
    }
    setVerified(prev => ({ ...prev, ...next }))
  }

  const searchLower = search.toLowerCase()
  const filteredCandidates = candidates.filter(c => {
    if (filter === 'exact' && c.score < 0.95) return false
    if (filter === 'high' && (c.score < 0.85 || c.score >= 0.95)) return false
    if (filter === 'review' && c.score >= 0.85) return false
    if (search && !c.apiTennisName.toLowerCase().includes(searchLower) && !c.dsgName.toLowerCase().includes(searchLower)) return false
    return true
  })

  const verifiedCount = Object.values(verified).filter(Boolean).length

  const monoSm = { fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }
  const monoXs = { fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }

  return (
    <div>
      {/* Bootstrap button */}
      <div className="bg-white rounded-sm border p-5 mb-4" style={{ borderColor: 'var(--chalk-dim)' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', marginBottom: '4px' }}>
          Bootstrap Mapping
        </h3>
        <p style={{ ...monoXs, color: 'var(--muted)', marginBottom: '12px' }}>
          Fetches player lists from api-tennis and DSG, then fuzzy-matches by name + nationality.
          High-confidence matches (&ge;95%) are auto-verified. Review the rest manually.
        </p>
        <button
          onClick={handleBootstrap}
          disabled={bootstrapStatus.type === 'loading'}
          className="px-5 py-2 rounded-sm text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: 'var(--court)', color: 'white', ...monoSm, cursor: 'pointer' }}
        >
          {bootstrapStatus.type === 'loading' ? 'Fetching...' : 'Bootstrap Player Mapping'}
        </button>
        {bootstrapStatus.type !== 'idle' && bootstrapStatus.type !== 'loading' && (
          <p className="mt-2" style={{ ...monoXs, color: bootstrapStatus.type === 'error' ? '#991b1b' : '#166534' }}>
            {bootstrapStatus.type === 'success' ? '\u2713 ' : '\u2717 '}{bootstrapStatus.message}
          </p>
        )}
      </div>

      {/* Results table */}
      {candidates.length > 0 && (
        <div className="bg-white rounded-sm border" style={{ borderColor: 'var(--chalk-dim)' }}>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 p-4 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search players..."
              className="flex-1 min-w-[150px]"
              style={{ ...monoSm, padding: '6px 10px', border: '1px solid var(--chalk-dim)', borderRadius: '2px' }}
            />
            <div className="flex gap-1">
              {(['all', 'exact', 'high', 'review'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    ...monoXs,
                    padding: '4px 10px',
                    borderRadius: '2px',
                    border: `1px solid ${filter === f ? 'var(--court)' : 'var(--chalk-dim)'}`,
                    background: filter === f ? 'var(--court)' : 'white',
                    color: filter === f ? 'white' : 'var(--muted)',
                    cursor: 'pointer',
                  }}
                >
                  {f === 'all' ? `All (${candidates.length})` : f === 'exact' ? `Exact (${candidates.filter(c => c.score >= 0.95).length})` : f === 'high' ? `High (${candidates.filter(c => c.score >= 0.85 && c.score < 0.95).length})` : `Review (${candidates.filter(c => c.score < 0.85).length})`}
                </button>
              ))}
            </div>
            <span style={{ ...monoXs, color: 'var(--muted)' }}>
              {verifiedCount} verified
            </span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--chalk-dim)' }}>
                  <th style={{ ...monoXs, padding: '8px 12px', textAlign: 'left', color: 'var(--muted)' }}>
                    <input type="checkbox" onChange={e => toggleAll(e.target.checked)} />
                  </th>
                  <th style={{ ...monoXs, padding: '8px 12px', textAlign: 'left', color: 'var(--muted)' }}>API-Tennis Player</th>
                  <th style={{ ...monoXs, padding: '8px 12px', textAlign: 'left', color: 'var(--muted)' }}>DSG Player</th>
                  <th style={{ ...monoXs, padding: '8px 12px', textAlign: 'left', color: 'var(--muted)' }}>Country</th>
                  <th style={{ ...monoXs, padding: '8px 12px', textAlign: 'center', color: 'var(--muted)' }}>Score</th>
                  <th style={{ ...monoXs, padding: '8px 12px', textAlign: 'center', color: 'var(--muted)' }}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {filteredCandidates.map(c => {
                  const tier = confidenceTier(c.score)
                  const isVerified = verified[c.apiTennisId] ?? false
                  return (
                    <tr
                      key={c.apiTennisId}
                      style={{
                        borderBottom: '1px solid var(--chalk-dim)',
                        background: isVerified ? '#f0fdf4' : 'white',
                      }}
                    >
                      <td style={{ padding: '6px 12px' }}>
                        <input
                          type="checkbox"
                          checked={isVerified}
                          onChange={() => toggleVerified(c.apiTennisId)}
                        />
                      </td>
                      <td style={{ ...monoSm, padding: '6px 12px', color: 'var(--ink)' }}>
                        {c.apiTennisName}
                        <span style={{ ...monoXs, color: 'var(--muted)', marginLeft: '6px' }}>
                          ({c.apiTennisId})
                        </span>
                      </td>
                      <td style={{ ...monoSm, padding: '6px 12px', color: 'var(--ink)' }}>
                        {c.dsgName}
                        <span style={{ ...monoXs, color: 'var(--muted)', marginLeft: '6px' }}>
                          ({c.dsgPlayerId})
                        </span>
                      </td>
                      <td style={{ ...monoXs, padding: '6px 12px', color: 'var(--muted)' }}>
                        {c.apiTennisCountry} / {c.dsgCountry}
                      </td>
                      <td style={{ ...monoSm, padding: '6px 12px', textAlign: 'center' }}>
                        {(c.score * 100).toFixed(0)}%
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                        <span style={{
                          ...monoXs,
                          padding: '2px 8px',
                          borderRadius: '2px',
                          color: tier.color,
                          background: tier.bg,
                        }}>
                          {tier.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Save */}
          <div className="flex items-center gap-4 p-4 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
            <button
              onClick={handleSave}
              disabled={saveStatus.type === 'loading' || verifiedCount === 0}
              className="px-5 py-2 rounded-sm text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--court)', color: 'white', ...monoSm, cursor: 'pointer' }}
            >
              {saveStatus.type === 'loading' ? 'Saving...' : `Save ${verifiedCount} Verified Mappings`}
            </button>
            {saveStatus.type !== 'idle' && saveStatus.type !== 'loading' && (
              <span style={{ ...monoXs, color: saveStatus.type === 'error' ? '#991b1b' : '#166534' }}>
                {saveStatus.type === 'success' ? '\u2713 ' : '\u2717 '}{saveStatus.message}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
