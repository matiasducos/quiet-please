import Link from 'next/link'
import { AdminHeader, Chip } from '../ui'
import { mono, when } from '../format'
import type { BannerReport, FeaturedCandidate } from './status'
import type { NoticeSpec } from '@/components/SiteNotice'

/**
 * Read-only view of `getBannerReport`.
 *
 * A server component on purpose: there is nothing to interact with, so shipping
 * a client bundle to render nine static rows would be all cost. Every number
 * here is computed at request time by the page, and this file only formats.
 *
 * Laid out as stacked cards rather than a grid table because the interesting
 * cell on most rows is a sentence, not a figure, and a 12-column table of
 * sentences is unreadable at 375px whatever you wrap it in.
 */

function SectionTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="mb-3">
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', letterSpacing: '-0.01em' }}>
        {children}
      </h2>
      {note && (
        <p style={{ ...mono, fontSize: '0.68rem', color: 'var(--muted)', lineHeight: 1.6, marginTop: '0.35rem' }}>
          {note}
        </p>
      )}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-sm border px-4 py-3"
      style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}
    >
      {children}
    </div>
  )
}

/** Label above value, so a long value wraps instead of squeezing the label. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div style={{ ...mono, fontSize: '0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        {label}
      </div>
      <div className="break-words" style={{ fontSize: '0.8rem', color: 'var(--ink)', lineHeight: 1.5, marginTop: '2px' }}>
        {children}
      </div>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ ...mono, fontSize: '0.72rem', background: 'var(--chalk)', padding: '1px 5px', borderRadius: '2px' }}>
      {children}
    </span>
  )
}

/**
 * What the bar looks like and says, straight off the spec the component uses.
 *
 * The CTA is a plain link rather than the bar's `TrackedCTA`: an admin opening
 * this page to read it must not mint `notice_*` click events, which would land
 * in the same funnels the notices are measured by.
 */
function NoticePreview({ spec }: { spec: NoticeSpec }) {
  return (
    <div className="rounded-sm border overflow-hidden" style={{ borderColor: spec.accent.base }}>
      <div style={{ background: spec.accent.soft }} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
        <span
          className="whitespace-nowrap"
          style={{ ...mono, fontSize: '0.65rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: spec.accent.ink, fontWeight: 600 }}
        >
          {spec.kicker}
        </span>
        <span style={{ fontSize: '0.85rem', color: 'var(--ink)', lineHeight: 1.5 }}>{spec.headline}</span>
      </div>
      <div className="px-4 py-2 flex items-center gap-2 flex-wrap" style={{ background: 'white', borderTop: `1px solid ${spec.accent.base}` }}>
        <Link
          href={spec.cta.href}
          className="inline-flex items-center justify-center min-h-[36px] px-3.5 text-xs font-medium rounded-sm"
          style={{ background: spec.accent.base, color: 'white', textDecoration: 'none' }}
        >
          {spec.cta.label}
        </Link>
        <span style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)' }} className="break-all">
          → {spec.cta.href}
        </span>
      </div>
    </div>
  )
}

/** The mechanics behind a live bar: what it tracks as, and what silences it. */
function SpecDetail({ spec }: { spec: NoticeSpec }) {
  const days = spec.dismissMaxAge ? Math.round(spec.dismissMaxAge / 86400) : 90
  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="CTA event location">
        <Code>{spec.cta.location}</Code>
      </Field>
      <Field label="Dismissal cookie">
        <Code>{spec.dismissCookieName}</Code>
        <span style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)' }}> · {days}d</span>
      </Field>
      <div className="sm:col-span-2">
        <Field label={`Hidden on ${spec.hidePathPrefixes?.length ?? 0} route prefixes`}>
          <span className="flex flex-wrap gap-1">
            {(spec.hidePathPrefixes ?? []).map(p => (
              <Code key={p}>{p}</Code>
            ))}
          </span>
        </Field>
      </div>
    </div>
  )
}

function FeaturedRow({ c }: { c: FeaturedCandidate }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem' }}>
            {c.flagEmoji} {c.name}{c.year ? ` ${c.year}` : ''}
          </div>
          <div style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginTop: '2px' }}>
            phase: {c.phase}
            {c.nextStartsAt && ` · starts ${new Date(c.nextStartsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}`}
            {c.daysOut !== null && ` · ${c.daysOut >= 0 ? `in ${c.daysOut}d` : `${-c.daysOut}d ago`}`}
          </div>
        </div>
        <Chip text={c.featured ? 'showing' : 'not showing'} tone={c.featured ? 'good' : 'muted'} />
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink)', lineHeight: 1.6, marginTop: '0.6rem' }}>
        {c.why}
      </p>
    </Card>
  )
}

export default function BannerStatus({ report }: { report: BannerReport }) {
  const { featured, audiences } = report

  return (
    <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <AdminHeader label="Site banners" />

      <main className="max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-10">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', letterSpacing: '-0.02em' }}>
            What visitors are seeing
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.6, marginTop: '0.4rem' }}>
            The announcement bar that mounts in the site nav, and whether it is up right now.
            Read-only — nothing on this page changes what is shown.
          </p>
          <p style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
            Evaluated {when(report.evaluatedAt)}
          </p>
        </div>

        {/* ── Who sees what ── */}
        <section className="mb-8">
          <SectionTitle>
            Right now
          </SectionTitle>
          <div className="flex flex-col gap-2">
            {audiences.map(a => (
              <Card key={a.audience}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)' }}>{a.audience}</span>
                  <Chip text={a.sees} tone={a.sees === 'Nothing' ? 'muted' : 'court'} />
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--ink)', lineHeight: 1.6, marginTop: '0.5rem' }}>
                  {a.why}
                </p>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Invite bar ── */}
        <section>
          <SectionTitle note={`Runs in the ${featured.leadDays} days before a major's draw is published, and retires itself the moment an admin saves that draw.`}>
            Invite bar
          </SectionTitle>

          {featured.spec && (
            <div className="mb-3">
              <NoticePreview spec={featured.spec} />
              <SpecDetail spec={featured.spec} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {featured.candidates.map(c => <FeaturedRow key={c.slug} c={c} />)}
          </div>
        </section>
      </main>
    </div>
  )
}
