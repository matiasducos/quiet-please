'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { AdminSeriesRow } from '../../actions'
import { hubTitle, TITLE_BUDGET } from '@/lib/tournaments/titles'

/**
 * Every series with the title it currently produces.
 *
 * The list shows the rendered <title> rather than the raw `name`/`short_name`
 * columns, because the whole reason to open this page is "is the searched term
 * in my title tag?" — and with `short_name` in play the columns don't answer
 * that. "Romanian Open" in `name` looks fine until you see the title says
 * "Bucharest".
 */
export default function SeriesList({ series }: { series: AdminSeriesRow[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return series
    return series.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        (s.short_name ?? '').toLowerCase().includes(q) ||
        s.slug.includes(q) ||
        (s.city ?? '').toLowerCase().includes(q),
    )
  }, [series, query])

  const unreviewed = series.filter(s => !s.slug_reviewed).length

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-8 py-4">
          <Link href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Admin
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Series &amp; SEO
          </span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 md:py-10">
        <header className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            Series &amp; SEO
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.5rem', lineHeight: 1.6 }}>
            The name here is what every edition shows as its heading and title tag.
            Pick whichever form people actually search — that is a per-tournament
            call, not a rule.
          </p>
        </header>

        {unreviewed > 0 && (
          <div
            className="rounded-sm border p-4 mb-5"
            style={{ borderColor: '#fcd34d', background: '#fffbeb' }}
          >
            <p style={{ fontSize: '0.85rem', color: '#92400e', lineHeight: 1.6 }}>
              <strong>{unreviewed} series {unreviewed === 1 ? 'is' : 'are'} unpublished.</strong>{' '}
              Their pages are noindex and absent from the sitemap, so search
              engines cannot see them. Their URL is still editable — once you
              publish it, it is permanent.
            </p>
          </div>
        )}

        <input
          type="text"
          placeholder="Search by name, slug or city…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full mb-4"
          style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '8px 12px',
            border: '1px solid var(--chalk-dim)', borderRadius: '2px',
            background: 'white', color: 'var(--ink)',
          }}
        />

        {/* Tables scroll inside their own container so a long title never
            pushes the page body sideways on a phone. */}
        <div className="overflow-x-auto rounded-sm border bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div className="min-w-[640px]">
            <div
              className="grid grid-cols-12 gap-3 px-4 py-2.5 border-b"
              style={{ borderColor: 'var(--chalk-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}
            >
              <span className="col-span-5">Title tag</span>
              <span className="col-span-4">URL</span>
              <span className="col-span-2">Editions</span>
              <span className="col-span-1">Len</span>
            </div>

            {filtered.map(s => {
              const title = hubTitle(s)
              const over = title.length > TITLE_BUDGET
              return (
                <Link
                  key={s.id}
                  href={`/admin/tournaments/series/${s.id}`}
                  className="grid grid-cols-12 gap-3 px-4 py-3 border-b last:border-0 hover:bg-[#fafaf8]"
                  style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none', color: 'var(--ink)', fontSize: '0.85rem' }}
                >
                  <span className="col-span-5">
                    <span style={{ display: 'block' }}>{title}</span>
                    {s.short_name && s.short_name !== s.name && (
                      // The gap this page exists to make visible: the heading
                      // and the title tag are different strings.
                      <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                        heading: {s.name}
                      </span>
                    )}
                  </span>
                  <span className="col-span-4" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', wordBreak: 'break-all' }}>
                    /{s.slug}
                    {!s.slug_reviewed && (
                      <span style={{ display: 'inline-block', marginLeft: '6px', fontSize: '0.6rem', letterSpacing: '0.06em', textTransform: 'uppercase', background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '9999px' }}>
                        Unpublished
                      </span>
                    )}
                  </span>
                  <span className="col-span-2" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                    {s.years.length > 0 ? `${s.years.length} (${s.years[s.years.length - 1]}–${s.years[0]})` : '—'}
                  </span>
                  <span
                    className="col-span-1"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: over ? '#b45309' : 'var(--muted)' }}
                  >
                    {title.length}
                  </span>
                </Link>
              )
            })}

            {filtered.length === 0 && (
              <p className="px-4 py-6" style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                No series match “{query}”.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
