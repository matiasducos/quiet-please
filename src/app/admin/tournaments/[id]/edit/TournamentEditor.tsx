'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateTournament } from '../../../actions'
import CountrySelect from '../../../CountrySelect'

interface TournamentData {
  id: string
  name: string
  tour: string
  category: string
  country: string
  city: string
  surface: string | null
  starts_at: string | null
  draw_size: number | null
  status: string
}

export default function TournamentEditor({ tournament }: { tournament: TournamentData }) {
  const router = useRouter()
  const [name, setName] = useState(tournament.name)
  const [tour, setTour] = useState<'ATP' | 'WTA'>(tournament.tour as 'ATP' | 'WTA')
  const [category, setCategory] = useState<'grand_slam' | 'masters_1000' | '500' | '250'>(
    tournament.category as 'grand_slam' | 'masters_1000' | '500' | '250',
  )
  const [country, setCountry] = useState(tournament.country)
  const [city, setCity] = useState(tournament.city)
  const [surface, setSurface] = useState<'hard' | 'clay' | 'grass'>(
    (tournament.surface as 'hard' | 'clay' | 'grass') ?? 'hard',
  )
  const [startsAt, setStartsAt] = useState(
    tournament.starts_at ? tournament.starts_at.slice(0, 10) : '',
  )
  const [drawSize, setDrawSize] = useState<32 | 64 | 128>(
    (tournament.draw_size as 32 | 64 | 128) ?? 32,
  )

  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'error' | 'success'; message?: string }>({ type: 'idle' })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !startsAt) return

    setStatus({ type: 'loading' })
    try {
      const { ok, error } = await updateTournament(tournament.id, {
        name: name.trim(),
        tour,
        category,
        country: country.trim(),
        city: city.trim(),
        surface,
        startsAt,
        drawSize,
      })
      if (ok) {
        setStatus({ type: 'success', message: 'Tournament updated successfully.' })
        router.refresh()
      } else {
        setStatus({ type: 'error', message: error ?? 'Failed to update tournament' })
      }
    } catch (err) {
      setStatus({ type: 'error', message: String(err) })
    }
  }

  const categories = [
    { value: 'grand_slam', label: 'Grand Slam' },
    { value: 'masters_1000', label: 'Masters 1000' },
    { value: '500', label: 'ATP/WTA 500' },
    { value: '250', label: 'ATP/WTA 250' },
  ]

  const inputStyle = {
    fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
    padding: '6px 10px', border: '1px solid var(--chalk-dim)',
    borderRadius: '2px', background: 'white', color: 'var(--ink)',
  }

  const labelStyle = {
    fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)',
    display: 'block' as const, marginBottom: '4px',
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Admin
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Edit Tournament
          </span>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Edit Tournament
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Update tournament details. Status: <strong>{tournament.status}</strong>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-sm border p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div className="flex flex-col gap-5">
            {/* Name */}
            <div>
              <label style={labelStyle}>Tournament Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Test Open 2026" style={{ ...inputStyle, width: '100%' }} required />
            </div>

            {/* Tour + Category */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label style={labelStyle}>Tour</label>
                <select value={tour} onChange={e => setTour(e.target.value as 'ATP' | 'WTA')} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
                  <option value="ATP">ATP</option>
                  <option value="WTA">WTA</option>
                </select>
              </div>
              <div className="flex-1">
                <label style={labelStyle}>Category</label>
                <select value={category} onChange={e => setCategory(e.target.value as typeof category)} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
                  {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            {/* Country + City */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label style={labelStyle}>Country</label>
                <CountrySelect value={country} onChange={setCountry} inputStyle={inputStyle} />
              </div>
              <div className="flex-1">
                <label style={labelStyle}>City</label>
                <input value={city} onChange={e => setCity(e.target.value)} placeholder="Madrid" style={{ ...inputStyle, width: '100%' }} />
              </div>
            </div>

            {/* Surface + Date + Draw Size */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label style={labelStyle}>Surface</label>
                <select value={surface} onChange={e => setSurface(e.target.value as typeof surface)} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
                  <option value="hard">Hard</option>
                  <option value="clay">Clay</option>
                  <option value="grass">Grass</option>
                </select>
              </div>
              <div className="flex-1">
                <label style={labelStyle}>Start Date</label>
                <input type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={{ ...inputStyle, width: '100%' }} required />
              </div>
              <div className="flex-1">
                <label style={labelStyle}>Draw Size</label>
                <select value={drawSize} onChange={e => setDrawSize(Number(e.target.value) as typeof drawSize)} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
                  <option value={32}>32</option>
                  <option value={64}>64</option>
                  <option value={128}>128</option>
                </select>
              </div>
            </div>

          </div>

          {status.type === 'error' && (
            <div className="mt-4 p-3 rounded-sm" style={{ background: '#fee2e2', borderLeft: '3px solid #ef4444' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#991b1b' }}>
                {status.message}
              </p>
            </div>
          )}

          {status.type === 'success' && (
            <div className="mt-4 p-3 rounded-sm" style={{ background: '#f0fdf4', borderLeft: '3px solid #22c55e' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#166534' }}>
                {status.message}
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 mt-6">
            <button
              type="submit"
              disabled={status.type === 'loading' || !name.trim() || !startsAt}
              className="px-6 py-2 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--court)', color: 'white' }}
            >
              {status.type === 'loading' ? 'Saving...' : 'Save Changes'}
            </button>
            <Link
              href="/admin"
              className="px-4 py-2 text-sm rounded-sm border transition-colors"
              style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </main>
  )
}
