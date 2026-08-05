'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateSeriesSeo, type AdminSeriesRow } from '../../../actions'
import CountrySelect from '../../../CountrySelect'
import { slugErrorMessage, slugify } from '@/lib/tournaments/slug'
import { editionTitle, hubTitle, TITLE_BUDGET } from '@/lib/tournaments/titles'

type Surface = 'hard' | 'clay' | 'grass'
type Category = 'grand_slam' | 'masters_1000' | '500' | '250'

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'grand_slam', label: 'Grand Slam' },
  { value: 'masters_1000', label: 'Masters 1000' },
  { value: '500', label: 'ATP/WTA 500' },
  { value: '250', label: 'ATP/WTA 250' },
]

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
  padding: '6px 10px', border: '1px solid var(--chalk-dim)',
  borderRadius: '2px', background: 'white', color: 'var(--ink)',
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)',
  display: 'block', marginBottom: '4px',
}

const hintStyle: React.CSSProperties = {
  fontSize: '0.75rem', color: 'var(--muted)', marginTop: '5px', lineHeight: 1.5,
}

export default function SeriesEditor({ series }: { series: AdminSeriesRow }) {
  const router = useRouter()

  const [name, setName] = useState(series.name)
  const [shortName, setShortName] = useState(series.short_name ?? '')
  const [city, setCity] = useState(series.city ?? '')
  const [country, setCountry] = useState(series.country ?? '')
  const [surface, setSurface] = useState<Surface | ''>(series.surface ?? '')
  const [category, setCategory] = useState<Category | ''>(series.category ?? '')
  const [slug, setSlug] = useState(series.slug)
  const [slugReviewed, setSlugReviewed] = useState(series.slug_reviewed)

  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'error' | 'success'; message?: string }>({ type: 'idle' })

  // A published slug is frozen. The server re-checks this against the database
  // rather than trusting the form, but disabling the input is what stops an
  // admin composing an edit that can only be rejected.
  const slugLocked = series.slug_reviewed
  const slugProblem = !slugLocked && slug !== series.slug ? slugErrorMessage(slug) : null

  // Previewed against the same functions the pages ship, so what is shown here
  // is what Google gets.
  const naming = { name: name.trim() || series.name, short_name: shortName.trim() || null }
  const previewHub = hubTitle(naming)
  const previewYear = series.years[0] ?? new Date().getUTCFullYear()
  const previewEdition = editionTitle(naming, previewYear, false)
  const previewH1 = `${naming.name} ${previewYear}`

  const dirty =
    name !== series.name ||
    shortName !== (series.short_name ?? '') ||
    city !== (series.city ?? '') ||
    country !== (series.country ?? '') ||
    surface !== (series.surface ?? '') ||
    category !== (series.category ?? '') ||
    slug !== series.slug ||
    slugReviewed !== series.slug_reviewed

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || slugProblem) return

    setStatus({ type: 'loading' })
    try {
      const { ok, error, slug: savedSlug } = await updateSeriesSeo(series.id, {
        name: name.trim(),
        shortName: shortName.trim(),
        city: city.trim(),
        country: country.trim(),
        surface: surface || null,
        category: category || null,
        slug: slugLocked ? undefined : slug.trim(),
        slugReviewed,
      })
      if (!ok) {
        setStatus({ type: 'error', message: error ?? 'Failed to update series' })
        return
      }
      setStatus({
        type: 'success',
        message: `Saved. The hub and every edition under /tournaments/${savedSlug} now use this name.`,
      })
      router.refresh()
    } catch (err) {
      setStatus({ type: 'error', message: String(err) })
    }
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-3xl mx-auto flex items-center justify-between px-4 md:px-8 py-4">
          <Link href="/admin/tournaments/series" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Series
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Edit series
          </span>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 md:py-10">
        <header className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {series.flag_emoji && <span style={{ marginRight: '8px' }}>{series.flag_emoji}</span>}
            {series.name}
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            /tournaments/{series.slug}
            {series.years.length > 0 && ` · ${series.years.length} edition${series.years.length === 1 ? '' : 's'}`}
          </p>
        </header>

        {/* ── Live preview ──
            Above the form, not below it. The point of this page is choosing
            between two names, and the choice is made by looking at the result. */}
        <section className="rounded-sm border bg-white p-4 md:p-5 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '12px' }}>
            What search engines will see
          </h2>

          {/* Labelled with the same words as the field hints below, so it is
              visible at a glance which box drives which line. */}
          <PreviewRow label="Search result — series page" value={previewHub} budget />
          <PreviewRow label={`Search result — ${previewYear} page`} value={previewEdition} budget />
          <PreviewRow label="Page heading" value={previewH1} />
        </section>

        <form onSubmit={handleSubmit} className="rounded-sm border bg-white p-4 md:p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div className="flex flex-col gap-5">
            <div>
              <label style={labelStyle}>Display name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
                required
              />
              <p style={hintStyle}>
                <strong style={{ color: 'var(--ink)' }}>
                  This is the one that must match what people search.
                </strong>{' '}
                It is the big heading on the tournament page, plus the breadcrumb
                and the name search engines read. Keep it sponsor-free.
              </p>
            </div>

            <div>
              <label style={labelStyle}>Short name (title tag)</label>
              <input
                value={shortName}
                onChange={e => setShortName(e.target.value)}
                placeholder={name || 'Same as display name'}
                style={{ ...inputStyle, width: '100%' }}
              />
              <p style={hintStyle}>
                <strong style={{ color: 'var(--ink)' }}>
                  Leave this empty unless the display name is too long.
                </strong>{' '}
                It only changes the blue title line in search results, where about{' '}
                {TITLE_BUDGET} characters fit. Shortening drops words people type, so
                only use it when the full name genuinely does not fit.
              </p>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <label style={labelStyle}>City</label>
                <input value={city} onChange={e => setCity(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
              </div>
              <div className="flex-1">
                <label style={labelStyle}>Country</label>
                <CountrySelect value={country} onChange={setCountry} inputStyle={inputStyle} />
              </div>
            </div>
            <p style={{ ...hintStyle, marginTop: '-12px' }}>
              Feeds the meta description (“… is a Masters 1000 event in Madrid,
              Spain”) and sets the flag. Each edition’s own location still wins on
              its page.
            </p>

            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <label style={labelStyle}>Surface</label>
                <select value={surface} onChange={e => setSurface(e.target.value as Surface | '')} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
                  <option value="">—</option>
                  <option value="hard">Hard</option>
                  <option value="clay">Clay</option>
                  <option value="grass">Grass</option>
                </select>
              </div>
              <div className="flex-1">
                <label style={labelStyle}>Category</label>
                <select value={category} onChange={e => setCategory(e.target.value as Category | '')} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
                  <option value="">—</option>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            <SlugField
              slug={slug}
              setSlug={setSlug}
              locked={slugLocked}
              problem={slugProblem}
              suggestion={slugify(name)}
              reviewed={slugReviewed}
              setReviewed={setSlugReviewed}
              wasReviewed={series.slug_reviewed}
              editionCount={series.years.length}
            />

            {status.type === 'error' && (
              <p style={{ fontSize: '0.8rem', color: '#b91c1c', lineHeight: 1.5 }}>{status.message}</p>
            )}
            {status.type === 'success' && (
              <p style={{ fontSize: '0.8rem', color: '#15803d', lineHeight: 1.5 }}>{status.message}</p>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="submit"
                disabled={status.type === 'loading' || !name.trim() || Boolean(slugProblem) || !dirty}
                className="px-4 py-2 rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: 'var(--court)', color: 'white', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', cursor: dirty ? 'pointer' : 'not-allowed' }}
              >
                {status.type === 'loading' ? 'Saving…' : 'Save'}
              </button>
              <Link
                href={`/tournaments/${series.slug}`}
                target="_blank"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}
              >
                View live page ↗
              </Link>
            </div>
          </div>
        </form>
      </div>
    </main>
  )
}

/** One previewed string, with the character count when a budget applies. */
function PreviewRow({ label, value, budget = false }: { label: string; value: string; budget?: boolean }) {
  const over = budget && value.length > TITLE_BUDGET
  return (
    <div className="mb-3 last:mb-0">
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', display: 'block', marginBottom: '3px' }}>
        {label}
      </span>
      <span style={{ fontSize: '0.95rem', color: '#1a0dab', lineHeight: 1.4, wordBreak: 'break-word', display: 'block' }}>
        {value}
      </span>
      {budget && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: over ? '#b45309' : 'var(--muted)' }}>
          {value.length}/{TITLE_BUDGET}
          {over && ' — likely truncated in results'}
        </span>
      )}
    </div>
  )
}

/**
 * The URL, which behaves differently depending on whether it has been published.
 *
 * Before publishing, the page is noindex and out of the sitemap, so nothing
 * outside the database has ever seen this URL and it is safe to correct. After,
 * it is the permanent address every backlink points at.
 */
function SlugField({
  slug, setSlug, locked, problem, suggestion, reviewed, setReviewed, wasReviewed, editionCount,
}: {
  slug: string
  setSlug: (v: string) => void
  locked: boolean
  problem: string | null
  suggestion: string
  reviewed: boolean
  setReviewed: (v: boolean) => void
  wasReviewed: boolean
  editionCount: number
}) {
  return (
    <div className="rounded-sm border p-4" style={{ borderColor: locked ? 'var(--chalk-dim)' : '#fcd34d', background: locked ? 'var(--chalk)' : '#fffbeb' }}>
      <label style={labelStyle}>URL slug</label>
      <div className="flex items-center gap-1 flex-wrap">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--muted)' }}>
          /tournaments/
        </span>
        <input
          value={slug}
          onChange={e => setSlug(e.target.value)}
          disabled={locked}
          className="flex-1 min-w-[160px]"
          style={{ ...inputStyle, opacity: locked ? 0.6 : 1, cursor: locked ? 'not-allowed' : 'text' }}
        />
      </div>

      {locked ? (
        <p style={hintStyle}>
          <strong>Locked.</strong> This URL is published and indexed. Changing it
          would 404 every existing link and hand back the ranking it has built.
          The display name above is free to change — the URL does not have to
          match it.
        </p>
      ) : (
        <>
          {problem && (
            <p style={{ fontSize: '0.75rem', color: '#b91c1c', marginTop: '5px' }}>{problem}</p>
          )}
          {!problem && suggestion && suggestion !== slug && (
            <p style={hintStyle}>
              Suggested from the display name:{' '}
              <button
                type="button"
                onClick={() => setSlug(suggestion)}
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--court)', textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                {suggestion}
              </button>
            </p>
          )}
          <p style={hintStyle}>
            Editable because this series is not published yet. Get it right now —
            publishing freezes it.
          </p>
        </>
      )}

      <label className="flex items-start gap-2 mt-3" style={{ cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={reviewed}
          onChange={e => setReviewed(e.target.checked)}
          style={{ marginTop: '3px' }}
        />
        <span style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
          <strong>Published</strong> — indexable and listed in the sitemap.
          {!wasReviewed && reviewed && (
            <span style={{ display: 'block', color: '#92400e', marginTop: '3px' }}>
              This locks <code style={{ fontFamily: 'var(--font-mono)' }}>/{slug}</code> permanently
              {editionCount > 0 && ` across ${editionCount} edition${editionCount === 1 ? '' : 's'}`}.
            </span>
          )}
          {wasReviewed && !reviewed && (
            <span style={{ display: 'block', color: '#b91c1c', marginTop: '3px' }}>
              Unpublishing noindexes a live page and drops it from the sitemap.
              Search engines will remove it from results.
            </span>
          )}
        </span>
      </label>
    </div>
  )
}
