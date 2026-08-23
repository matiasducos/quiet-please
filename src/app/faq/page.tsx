import Link from 'next/link'
import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import { getNavProfile } from '@/lib/supabase/profile'
import FaqControls from '@/components/faq/FaqControls'
import {
  FAQ_SECTIONS,
  ALL_FAQ_QUESTIONS,
  answerToPlainText,
  type FaqBlock,
} from '@/lib/faq/content'

/**
 * The reference manual, as questions.
 *
 * Distinct from /onboarding, which is a four-step demo that sells the idea to
 * somebody who has never filled in a bracket. This is for the person already
 * playing who wants to know what a semifinal is worth, or why a correct pick
 * only paid single points. Different reader, different job — /onboarding is a
 * pitch and this is a lookup, which is why it is a flat list of answers with
 * stable anchors rather than a narrative.
 *
 * Content is data (src/lib/faq/content.ts). Adding a question is a data edit;
 * nothing here needs touching.
 */

export const metadata: Metadata = {
  title: 'How scoring works — points, multipliers and locking',
  description:
    'How points, the streak multiplier and locking work on Quiet Please: what each round is worth, what builds and breaks a streak, and the difference between locking a round and locking your whole bracket.',
  // Per-page, never on the root layout — metadata cascades, and a canonical set
  // once at the top makes every page claim to be the homepage.
  alternates: { canonical: '/faq' },
}

function Block({ block }: { block: FaqBlock }) {
  if (block.type === 'p') {
    return (
      <p style={{ fontSize: '0.95rem', lineHeight: 1.75, color: 'var(--ink)', marginBottom: '0.85rem' }}>
        {block.text}
      </p>
    )
  }

  if (block.type === 'ul') {
    return (
      <ul style={{ marginBottom: '0.85rem', paddingLeft: '1.1rem', listStyle: 'disc' }}>
        {block.items.map((item, i) => (
          <li key={i} style={{ fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--ink)', marginBottom: '0.35rem' }}>
            {item}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div style={{ marginBottom: '0.85rem' }}>
      {/* House rule: a table narrower than its content scrolls inside its own
          box rather than pushing the page sideways. The points grid is five
          columns and does not fit 375px. */}
      <div className="overflow-x-auto">
        <table className="min-w-[420px] w-full" style={{ borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr>
              {block.head.map((h, i) => (
                <th
                  key={i}
                  scope="col"
                  style={{
                    textAlign: i === 0 ? 'left' : 'right',
                    padding: '0.5rem 0.6rem',
                    borderBottom: '1px solid var(--chalk-dim)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.65rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--muted)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    style={{
                      textAlign: c === 0 ? 'left' : 'right',
                      padding: '0.5rem 0.6rem',
                      borderBottom: '1px solid var(--chalk-dim)',
                      color: c === 0 ? 'var(--ink)' : 'var(--muted)',
                      fontFamily: c === 0 ? 'inherit' : 'var(--font-mono)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.caption && (
        <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.4rem' }}>{block.caption}</p>
      )}
    </div>
  )
}

export default async function FaqPage() {
  const { profile, user } = await getNavProfile()

  // FAQPage structured data, built from the same blocks the page renders — see
  // the note in content.ts for why the answers are not written twice.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: ALL_FAQ_QUESTIONS.map(q => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: answerToPlainText(q.answer) },
    })),
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Nav
        deletionRequestedAt={profile?.deletion_requested_at}
        username={profile?.username}
        points={profile?.ranking_points ?? 0}
        userId={user?.id}
        activePage="faq"
      />

      {/* Native disclosure triangles differ per browser and sit oddly against a
          display-font question; ::-webkit-details-marker plus list-none removes
          them so the +/− below is the only marker. */}
      <style>{`
        .faq-item > summary::-webkit-details-marker { display: none; }
        .faq-item > summary::marker { content: ''; }
        .faq-item[open] > summary .faq-marker::before { content: '\u2212'; }
        .faq-item:not([open]) > summary .faq-marker::before { content: '+'; }
        .faq-item > summary .faq-marker { width: 0.9rem; display: inline-block; font-size: 1rem; }
        .faq-item > summary:hover { color: var(--court); }
      `}</style>

      <div className="max-w-3xl mx-auto px-4 md:px-8 py-12 md:py-16">
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.75rem' }}>
          Help
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
          How it all works
        </h1>
        <p style={{ fontSize: '1rem', color: 'var(--muted)', lineHeight: 1.7, marginBottom: '2.5rem' }}>
          Everything about scoring, in plain terms. New to the game?{' '}
          <Link href="/onboarding" style={{ color: 'var(--court)' }}>Start with the walkthrough</Link>.
        </p>

        {/* Contents. A reference is something people arrive at with one question,
            usually from a link elsewhere in the app — this is how they get to it
            without reading the rest. */}
        <nav aria-label="Contents" className="mb-12 rounded-sm border bg-white p-4 md:p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
          {FAQ_SECTIONS.map(section => (
            <div key={section.id} className="mb-5 last:mb-0">
              {/* The section name, not a label. At 0.65rem uppercase mono it read
                  as a form caption and the six groups blurred into one list; the
                  contents is the main way around a 25-question page, so the
                  groups have to be the thing the eye lands on. */}
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)', marginBottom: '0.5rem' }}>
                {section.title}
              </p>
              <ul>
                {section.questions.map(q => (
                  <li key={q.id} style={{ marginBottom: '0.2rem' }}>
                    <a href={`#${q.id}`} style={{ fontSize: '0.875rem', color: 'var(--court)', lineHeight: 1.6 }}>
                      {q.question}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <FaqControls />

        {FAQ_SECTIONS.map(section => (
          <section key={section.id} id={section.id} className="mb-14">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', letterSpacing: '-0.01em', marginBottom: section.intro ? '0.35rem' : '1.25rem' }}>
              {section.title}
            </h2>
            {section.intro && (
              <p style={{ fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>{section.intro}</p>
            )}

            {section.questions.map(q => (
              // A <details>, not a div with a click handler: it opens without
              // JavaScript, it is a disclosure widget to a screen reader for
              // free, and the answer stays in the HTML when closed — which is
              // what keeps it indexable and keeps the structured data matching
              // the page. FaqControls only adds what HTML cannot do.
              <details
                key={q.id}
                id={q.id}
                data-faq
                // Anchored questions are linked from the bracket, so the summary
                // must clear the sticky nav when one is jumped to. Measured, not
                // guessed: the nav is 99px tall at 375px, where it wraps onto two
                // rows, so scroll-mt-24 (96px) left it 3px underneath.
                className="faq-item scroll-mt-28 border-b"
                style={{ borderColor: 'var(--chalk-dim)' }}
              >
                <summary
                  className="flex items-start gap-3 cursor-pointer list-none py-3.5"
                  style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', letterSpacing: '-0.01em', color: 'var(--ink)' }}
                >
                  <span className="faq-marker shrink-0" aria-hidden="true" style={{ color: 'var(--court)', lineHeight: 1.6 }} />
                  <span className="flex-1">{q.question}</span>
                </summary>
                <div className="pb-4 pl-6">
                  {q.answer.map((block, i) => <Block key={i} block={block} />)}
                </div>
              </details>
            ))}
          </section>
        ))}

        <div className="rounded-sm border bg-white p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '0.4rem' }}>
            Something not covered here?
          </p>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.7 }}>
            Email{' '}
            <a href="mailto:support@quietplease.app" style={{ color: 'var(--court)' }}>support@quietplease.app</a>
            {' '}and we will answer — and add it to this page.
          </p>
        </div>
      </div>
    </main>
  )
}
