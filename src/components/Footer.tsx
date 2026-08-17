import Link from 'next/link'
import { ALL_SLAMS } from '@/lib/slams/config'
import CookieSettingsLink from '@/components/CookieSettingsLink'

export default function Footer() {
  return (
    <footer className="border-t py-6" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="max-w-5xl mx-auto px-4 md:px-8 flex flex-col gap-4">

        {/* Grand Slam links. These are site-wide on purpose: without an internal
            link the landing pages are orphans, discoverable only via the sitemap
            and accruing no internal link equity. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Grand Slam brackets
          </span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0">
            {ALL_SLAMS.map(slam => (
              <Link
                key={slam.slug}
                href={slam.route}
                className="inline-flex items-center min-h-[44px]"
                style={{ fontSize: '0.75rem', color: 'var(--muted)' }}
              >
                {slam.flagEmoji} {slam.name}
              </Link>
            ))}
          </div>
        </div>

        {/* Contact. Spelled out rather than hidden behind a "Contact" link:
            this footer is on every page, and the address is the only support
            channel there is — no form, no ticket queue, no chatbot. Rendering
            the address as text also means it still works for anyone whose
            browser has no mail handler wired up to mailto:. */}
        <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Contact
          </span>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            Questions, comments or suggestions? Write to{' '}
            {/* No min-h-[44px] here, unlike the links below: this one sits
                mid-sentence, where a 44px box would break the line flow.
                A full email address is a wide target already — the hit area
                problem the other links have comes from their short labels. */}
            <a href="mailto:support@quietplease.app" style={{ color: 'var(--court)' }}>
              support@quietplease.app
            </a>{' '}
            — every message is read.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            © {new Date().getFullYear()} Quiet Please
          </p>
          {/* min-h-[44px] keeps these tappable on a phone — at their 0.75rem font
              size the natural hit area is only ~18px tall. */}
          <div className="flex items-center flex-wrap gap-2">
            <Link href="/terms" className="inline-flex items-center min-h-[44px] px-2" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Terms</Link>
            <Link href="/privacy" className="inline-flex items-center min-h-[44px] px-2" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Privacy</Link>
            {/* Meta requires a deletion URL reachable without an account, and a
                sitemap entry with nothing linking to it is an orphan — one link
                settles both. */}
            <Link href="/data-deletion" className="inline-flex items-center min-h-[44px] px-2" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Delete data</Link>
            <CookieSettingsLink />
            {/* No "Contact" link here any more — the address itself is above,
                so a second entry point pointing at the same mailto: was just
                noise in the legal row. */}
          </div>
        </div>
      </div>
    </footer>
  )
}
