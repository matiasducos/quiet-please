import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t py-6" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="max-w-5xl mx-auto px-4 md:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          © {new Date().getFullYear()} Quiet Please
        </p>
        <div className="flex items-center gap-4">
          <Link href="/terms" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Terms</Link>
          <Link href="/privacy" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Privacy</Link>
          <a href="mailto:support@quietplease.app" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Contact</a>
        </div>
      </div>
    </footer>
  )
}
