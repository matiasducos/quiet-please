import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col" style={{ background: 'var(--chalk)' }}>
      <nav className="flex items-center justify-between px-8 py-6">
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'var(--ink)' }}>
          Quiet Please
        </span>
        <div className="flex items-center gap-4">
          <Link href="/login" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Sign in</Link>
          <Link href="/signup" className="px-4 py-2 text-sm text-white rounded-sm" style={{ background: 'var(--court)' }}>
            Get started
          </Link>
        </div>
      </nav>
      <section className="flex-1 flex flex-col items-center justify-center px-8 text-center py-24">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-8 rounded-sm text-xs tracking-widest uppercase"
          style={{ background: 'var(--court-dark)', color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-mono)' }}>
          <span style={{ color: 'var(--clay-light)' }}>●</span>
          ATP · WTA · All tournaments
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(3rem, 8vw, 6.5rem)', lineHeight: '1.0', letterSpacing: '-0.02em', color: 'var(--ink)', maxWidth: '14ch' }}>
          Predict.<br /><em style={{ color: 'var(--court)' }}>Compete.</em><br />Win.
        </h1>
        <p className="mt-8" style={{ fontSize: '1.125rem', color: 'var(--muted)', maxWidth: '42ch', lineHeight: '1.6', fontWeight: 300 }}>
          Fill out the bracket before the draw closes. Earn real ATP & WTA points for every correct pick. Challenge your friends across the full season.
        </p>
        <div className="flex items-center gap-4 mt-10">
          <Link href="/signup" className="px-8 py-3.5 text-white text-sm font-medium rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
            Start predicting — it's free
          </Link>
          <Link href="/login" className="px-8 py-3.5 text-sm font-medium rounded-sm border" style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}>
            Sign in
          </Link>
        </div>
      </section>
      <section className="grid grid-cols-1 md:grid-cols-3 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
        {[
          { label: 'Real points', desc: 'Scored using the official ATP & WTA point structure — same as the pros.' },
          { label: 'Full calendar', desc: 'Every ATP and WTA tournament, automatically synced from the official draws.' },
          { label: 'Private leagues', desc: 'Create a group, share the invite link, and track standings across the season.' },
        ].map((f, i) => (
          <div key={i} className="px-10 py-10 border-b md:border-b-0 md:border-r last:border-r-0" style={{ borderColor: 'var(--chalk-dim)' }}>
            <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--court)', fontFamily: 'var(--font-mono)' }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <div className="font-medium mb-2">{f.label}</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: '1.6' }}>{f.desc}</div>
          </div>
        ))}
      </section>
    </main>
  )
}