'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createTournament, type AdminSeriesOption } from '../../actions'
import CountrySelect from '../../CountrySelect'
import { slugify, slugErrorMessage } from '@/lib/tournaments/slug'

export default function TournamentCreator({ series: seriesList }: { series: AdminSeriesOption[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [tour, setTour] = useState<'ATP' | 'WTA'>('ATP')
  const [category, setCategory] = useState<'grand_slam' | 'masters_1000' | '500' | '250'>('250')
  const [country, setCountry] = useState('')
  const [city, setCity] = useState('')
  const [surface, setSurface] = useState<'hard' | 'clay' | 'grass'>('hard')
  const [startsAt, setStartsAt] = useState('')
  const [drawSize, setDrawSize] = useState<32 | 64 | 128>(32)

  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'error'; message?: string }>({ type: 'idle' })

  // ── Series ─────────────────────────────────────────────────────────────────
  // A tournament is an EDITION of a series, and the series owns the public URL.
  // From the second season onward the answer is almost always "an existing
  // one", so that is the default mode.
  const [seriesMode, setSeriesMode] = useState<'existing' | 'new'>('existing')
  const [seriesId, setSeriesId] = useState('')
  const [seriesName, setSeriesName] = useState('')
  // Only holds a value once the field has been hand-edited. The slug below is
  // DERIVED rather than synced from `name` in an effect — the suggestion is
  // wrong for most real tournaments (22 of the 34 currently in the database
  // are named after a title sponsor), so an edit is a decision that must stick.
  const [slugOverride, setSlugOverride] = useState<string | null>(null)

  const slug = slugOverride ?? slugify(seriesName || name)

  const year = startsAt ? new Date(startsAt).getUTCFullYear() : null
  const selectedSeries = seriesList.find(s => s.id === seriesId) ?? null
  const slugProblem = seriesMode === 'new' && slug ? slugErrorMessage(slug) : null
  const slugTaken =
    seriesMode === 'new' && slug ? seriesList.some(s => s.slug === slug) : false
  // Warn before the unique index does: one edition per series, year and tour.
  const yearTaken =
    seriesMode === 'existing' && selectedSeries && year
      ? selectedSeries.years.includes(year)
      : false

  const effectiveSlug = seriesMode === 'new' ? slug : selectedSeries?.slug ?? ''
  const seriesReady =
    seriesMode === 'existing' ? Boolean(seriesId) : Boolean(slug) && !slugProblem && !slugTaken

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !startsAt || !seriesReady) return

    setStatus({ type: 'loading' })
    try {
      const { ok, tournamentId, error } = await createTournament({
        name: name.trim(),
        tour,
        category,
        country: country.trim(),
        city: city.trim(),
        surface,
        startsAt,
        drawSize,
        series:
          seriesMode === 'existing'
            ? { mode: 'existing', seriesId }
            : { mode: 'new', slug, name: seriesName.trim() || name.trim() },
      })
      if (ok && tournamentId) {
        router.push(`/admin/tournaments/${tournamentId}/draw`)
      } else {
        setStatus({ type: 'error', message: error ?? 'Failed to create tournament' })
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
            New Tournament
          </span>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Create Tournament
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Create a manual tournament for testing predictions.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-sm border p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div className="flex flex-col gap-5">
            {/* Name */}
            <div>
              <label style={labelStyle}>Tournament Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Terra Wortmann Open" style={{ ...inputStyle, width: '100%' }} required />
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', marginTop: '4px' }}>
                The branded name for this year, sponsor and all. The public URL comes from the series below.
              </p>
            </div>

            {/* ── Series ──────────────────────────────────────────────────── */}
            <div className="rounded-sm border p-4" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
              <label style={{ ...labelStyle, marginBottom: '8px' }}>Series</label>

              <div className="flex gap-4 mb-3" style={{ fontSize: '0.8rem' }}>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={seriesMode === 'existing'}
                    onChange={() => setSeriesMode('existing')}
                  />
                  Existing tournament
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={seriesMode === 'new'}
                    onChange={() => setSeriesMode('new')}
                  />
                  Brand new event
                </label>
              </div>

              {seriesMode === 'existing' ? (
                <>
                  <select
                    value={seriesId}
                    onChange={e => setSeriesId(e.target.value)}
                    style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}
                  >
                    <option value="">Select a series…</option>
                    {seriesList.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} — /{s.slug}
                        {s.years.length > 0 ? ` (${s.years.join(', ')})` : ''}
                      </option>
                    ))}
                  </select>
                  {yearTaken && (
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#991b1b', marginTop: '6px' }}>
                      {selectedSeries?.name} already has a {tour} edition for {year}.
                    </p>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <div>
                    <label style={labelStyle}>Series name (sponsor-free, permanent)</label>
                    <input
                      value={seriesName}
                      onChange={e => setSeriesName(e.target.value)}
                      placeholder="Halle Open"
                      style={{ ...inputStyle, width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>URL slug — cannot be changed later</label>
                    <input
                      value={slug}
                      onChange={e => setSlugOverride(e.target.value)}
                      placeholder="halle-open"
                      style={{
                        ...inputStyle,
                        width: '100%',
                        borderColor: slugProblem || slugTaken ? '#ef4444' : 'var(--chalk-dim)',
                      }}
                    />
                    {slugProblem || slugTaken ? (
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#991b1b', marginTop: '4px' }}>
                        {slugTaken ? 'That slug is already taken.' : slugProblem}
                      </p>
                    ) : (
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', marginTop: '4px' }}>
                        Prefer what people search over the sponsor: <strong>halle-open</strong>, not
                        {' '}terra-wortmann-open. Sponsors change; this URL never does.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {effectiveSlug && year && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--ink)', marginTop: '10px' }}>
                  Public URL: <strong>/tournaments/{effectiveSlug}/{year}</strong>
                </p>
              )}
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

          <button
            type="submit"
            disabled={status.type === 'loading' || !name.trim() || !startsAt || !seriesReady || yearTaken}
            className="mt-6 px-6 py-2 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--court)', color: 'white' }}
          >
            {status.type === 'loading' ? 'Creating...' : 'Create Tournament'}
          </button>
        </form>
      </div>
    </main>
  )
}
