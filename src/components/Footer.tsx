import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t py-6" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="max-w-5xl mx-auto px-4 md:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          © {new Date().getFullYear()} Quiet Please
        </p>
        {/* min-h-[44px] keeps these tappable on a phone — at their 0.75rem font
            size the natural hit area is only ~18px tall. */}
        <div className="flex items-center gap-2">
          <Link href="/terms" className="inline-flex items-center min-h-[44px] px-2" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Terms</Link>
          <Link href="/privacy" className="inline-flex items-center min-h-[44px] px-2" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Privacy</Link>
          <a href="mailto:support@quietplease.app" className="inline-flex items-center min-h-[44px] px-2" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Contact</a>
        </div>
      </div>
    </footer>
  )
}
