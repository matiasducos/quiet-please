import Link from 'next/link'
import { AdminHeader, Chip, type ChipTone } from '../ui'
import { mono, when } from '../format'
import type { BannerReport, PickGapCandidate, FeaturedCandidate } from './status'
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

const OUTCOME_TONE: Record<PickGapCandidate['outcome'], ChipTone> = {
  would_show: 'good',
  no_gaps: 'muted',
  no_draw: 'warn',
  sandbox: 'muted',
}

const OUTCOME_LABEL: Record<PickGapCandidate['outcome'], string> = {
  would_show: 'would show',
  no_gaps: 'no gaps',
  no_draw: 'no draw',
  sandbox: 'sandbox',
}

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

function PickGapRow({ c }: { c: PickGapCandidate }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem' }}>
            {c.flagEmoji ? `${c.flagEmoji} ` : ''}{c.name}
          </div>
          <div style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginTop: '2px' }}>
            {[c.location, c.tour, c.seriesSlug ? `/${c.seriesSlug}` : 'no series slug'].filter(Boolean).join(' · ')}
          </div>
        </div>
        <Chip text={OUTCOME_LABEL[c.outcome]} tone={OUTCOME_TONE[c.outcome]} />
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--ink)', lineHeight: 1.6, marginTop: '0.6rem' }}>
        {c.why}
      </p>

      {c.drawMatches > 0 && (
        <div style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
          {c.drawMatches} matches in the draw · {c.playedMatches} played
          {c.slotLimited && ' · weekly-slot check also applies, not evaluated here'}
        </div>
      )}

      {c.spec && (
        <div className="mt-3">
          <NoticePreview spec={c.spec} />
          <SpecDetail spec={c.spec} />
        </div>
      )}
    </Card>
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
  const { pickGap, featured, audiences } = report

  return (
    <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <AdminHeader label="Site banners" />

      <main className="max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-10">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', letterSpacing: '-0.02em' }}>
            What visitors are seeing
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.6, marginTop: '0.4rem' }}>
            The two announcement bars that mount in the site nav, and which one is reaching whom
            right now. Read-only — nothing on this page changes what is shown.
          </p>
          <p style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
            Evaluated {when(report.evaluatedAt)} · prediction mode: {report.predictionMode}
          </p>
        </div>

        {/* ── Who sees what ── */}
        <section className="mb-8">
          <SectionTitle note="Only one bar ever renders. SiteNotices arbitrates, and the pick-gap bar outranks the invite bar — including when it has been dismissed, so pressing × does not summon the other one.">
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

        {/* ── Pick-gap bar ── */}
        <section className="mb-8">
          <SectionTitle note="Per-user, so this is evaluated for a signed-in visitor with no bracket in any live tournament — the case most likely to see it. Anyone with picks sees it for fewer tournaments, never more.">
            <span className="flex items-center gap-2 flex-wrap">
              Pick-gap bar
              <Chip
                text={report.pickGapEnabled ? 'enabled' : 'off — prediction mode'}
                tone={report.pickGapEnabled ? 'good' : 'alert'}
              />
            </span>
          </SectionTitle>

          {!report.pickGapEnabled && (
            <div className="rounded-sm border px-4 py-3 mb-3" style={{ borderColor: '#fbbf24', background: '#fffbeb' }}>
              <p style={{ ...mono, fontSize: '0.72rem', color: '#92400e', lineHeight: 1.6 }}>
                Prediction mode is <strong>{report.predictionMode}</strong>, which does not allow predicting an
                in-progress tournament. The bar is off for every user regardless of the rows below.
              </p>
            </div>
          )}

          {pickGap.candidates.length === 0 ? (
            <Card>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                No tournament is in progress, so there is nothing to nudge anyone about.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {pickGap.candidates.map(c => <PickGapRow key={c.id} c={c} />)}
            </div>
          )}

          {pickGap.candidates.length > 1 && pickGap.winner && (
            <p style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', lineHeight: 1.6, marginTop: '0.6rem' }}>
              More than one tournament qualifies. The bar shows the first by start date —{' '}
              <strong>{pickGap.winner.name}</strong> — and never stacks.
            </p>
          )}
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
