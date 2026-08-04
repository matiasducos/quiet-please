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

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            © {new Date().getFullYear()} Quiet Please
          </p>
          {/* min-h-[44px] keeps these tappable on a phone — at their 0.75rem font
              size the natural hit area is only ~18px tall. */}
          <div className="flex items-center flex-wrap gap-2">
            <Link href="/terms" className="inline-flex items-center min-h-[44px] px-2" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Terms</Link>
            <Link href="/privacy" className="inline-flex items-center min-h-[44px] px-2" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Privacy</Link>
            <CookieSettingsLink />
            <a href="mailto:support@quietplease.app" className="inline-flex items-center min-h-[44px] px-2" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Contact</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
