import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import TournamentCard from '@/components/TournamentCard'
import { nameToFlag } from '@/app/admin/countries'

// ── Cached homepage data: live tournaments + top players ──────────────────
const getHomepageData = unstable_cache(
  async () => {
    const admin = createAdminClient()
    const [{ data: live }, { data: top }] = await Promise.all([
      admin.from('tournaments')
        .select('id, name, location, flag_emoji, category, tour, surface, starts_at, ends_at, status')
        .eq('status', 'in_progress')
        .order('starts_at', { ascending: true })
        .limit(4),
      admin.from('users')
        .select('id, username, ranking_points, country')
        .gt('ranking_points', 0)
        .order('ranking_points', { ascending: false })
        .limit(5),
    ])
    return { liveTournaments: live ?? [], topPlayers: top ?? [] }
  },
  ['homepage-data'],
  { revalidate: 300 }
)

// ── Static bracket mock (replace with /public/bracket-demo.gif when ready) ──
function MockBracketPreview() {
  const green = 'var(--court)'
  const dim = 'var(--chalk-dim)'
  const muted = 'var(--muted)'

  type MatchData = { p1: string; p2: string; picked: string; correct?: boolean; wrong?: boolean }

  function MatchCard({ p1, p2, picked, correct, wrong }: MatchData) {
    const red = '#b91c1c'
    return (
      <div style={{ width: '116px', border: `1px solid ${dim}`, borderRadius: '3px', overflow: 'hidden', background: 'white', fontSize: '11px', fontFamily: 'var(--font-body)' }}>
        {[p1, p2].map(name => {
          const isPicked = name === picked
          const isWrongPick   = !!wrong && isPicked        // user's pick — turned out wrong
          const isActualWinner = !!wrong && !isPicked      // who actually won

          const bg    = isWrongPick    ? '#fef2f2'
                      : isActualWinner ? '#edf7f0'
                      : correct && isPicked ? '#e8f5e9'
                      : isPicked           ? '#eaf3de'
                      : 'white'
          const color = isWrongPick    ? red
                      : isActualWinner ? green
                      : isPicked       ? green
                      : 'var(--ink)'
          const border = isWrongPick    ? '#fca5a5'
                       : isActualWinner ? green
                       : isPicked       ? green
                       : 'transparent'
          return (
            <div key={name} style={{
              padding: '5px 8px',
              background: bg,
              color,
              borderLeft: `3px solid ${border}`,
              borderBottom: `1px solid ${dim}`,
              fontWeight: (isPicked || isActualWinner) ? 500 : 400,
            }}>
              {name}
              {correct       && isPicked     && <span style={{ opacity: 0.7 }}> ✓</span>}
              {isWrongPick                   && <span style={{ opacity: 0.8 }}> ✗</span>}
              {isActualWinner                && <span style={{ opacity: 0.7 }}> ✓</span>}
            </div>
          )
        })}
      </div>
    )
  }

  const r16: MatchData[] = [
    { p1: 'Djokovic',  p2: 'Alcaraz',  picked: 'Alcaraz',  correct: true },
    { p1: 'Sinner',    p2: 'Medvedev',  picked: 'Sinner',   wrong: true },
    { p1: 'Ruud',      p2: 'Rune',      picked: 'Ruud' },
    { p1: 'Fritz',     p2: 'Zverev',    picked: 'Zverev' },
  ]
  const qf: MatchData[] = [
    { p1: 'Alcaraz', p2: 'Medvedev', picked: 'Alcaraz' },
    { p1: 'Ruud',    p2: 'Zverev',   picked: 'Zverev' },
  ]
  const sf: MatchData[] = [
    { p1: 'Alcaraz', p2: 'Zverev', picked: 'Alcaraz' },
  ]

  const colHeader = { fontFamily: 'var(--font-mono)', fontSize: '9px', color: muted, letterSpacing: '2px', textTransform: 'uppercase' as const, textAlign: 'center' as const, marginBottom: '10px' }

  return (
    <div style={{ background: 'var(--chalk)', padding: '20px 24px 20px', overflowX: 'auto' }}>
      {/* Points badge */}
      <div className="flex justify-end mb-2">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', background: '#eaf3de', color: green, padding: '2px 8px', borderRadius: '2px', letterSpacing: '0.04em' }}>
          +360 pts · ×1.5 streak
        </span>
      </div>

      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', minWidth: 'max-content' }}>
        {/* R16 */}
        <div>
          <div style={colHeader}>R16</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {r16.map((m, i) => <MatchCard key={i} {...m} />)}
          </div>
        </div>

        {/* QF */}
        <div style={{ marginTop: '30px' }}>
          <div style={colHeader}>QF</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '54px' }}>
            {qf.map((m, i) => <MatchCard key={i} {...m} />)}
          </div>
        </div>

        {/* SF */}
        <div style={{ marginTop: '80px' }}>
          <div style={colHeader}>SF</div>
          {sf.map((m, i) => <MatchCard key={i} {...m} />)}
        </div>

        {/* Champion marker */}
        <div style={{ marginTop: '136px', paddingLeft: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: muted, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '10px' }}>Final</div>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#eaf3de', border: `1.5px solid ${green}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>
            🏆
          </div>
        </div>
      </div>

      {/* TODO: Replace MockBracketPreview with an actual screenshot or GIF once ready.
          Store file at: /public/bracket-demo.gif
          Recommended: 800×520px animated GIF or PNG, max 3 MB
          Then replace <MockBracketPreview /> in this file with:
          <img src="/bracket-demo.gif" alt="Bracket predictor" width={800} height={520} style={{ width: '100%', height: 'auto', display: 'block' }} />
      */}
    </div>
  )
}

export default async function HomePage() {
  const { liveTournaments, topPlayers } = await getHomepageData()

  return (
    <main className="min-h-screen flex flex-col" style={{ background: 'var(--chalk)' }}>

      {/* ── Nav ───────────────────────────────────────────────────── */}
      <nav className="border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-8 py-3 md:py-5">
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'var(--ink)' }}>
            Quiet Please
          </span>
          <div className="flex items-center gap-4">
            <Link href="/login" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Sign in</Link>
            <Link href="/signup" className="px-4 py-2 text-sm text-white rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center px-4 md:px-8 text-center pt-12 pb-16 md:pt-20 md:pb-24">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 mb-8 rounded-sm text-xs tracking-widest uppercase"
          style={{ background: 'var(--court-dark)', color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-mono)' }}
        >
          <span style={{ color: 'var(--clay)' }}>●</span>
          ATP · WTA · All tournaments
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(3rem, 8vw, 6.5rem)', lineHeight: '1.0', letterSpacing: '-0.02em', color: 'var(--ink)', maxWidth: '14ch' }}>
          Predict.<br /><em style={{ color: 'var(--court)' }}>Compete.</em><br />Win.
        </h1>
        <p className="mt-8" style={{ fontSize: '1.125rem', color: 'var(--muted)', maxWidth: '42ch', lineHeight: '1.6', fontWeight: 300 }}>
          Fill out the bracket before the draw closes. Earn real ATP &amp; WTA points for every correct pick. Challenge your friends across the full season.
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-3 mt-10">
          <Link
            href="/signup"
            className="w-full sm:w-auto px-6 py-3.5 md:px-8 text-white text-sm font-medium rounded-sm hover:opacity-90 text-center"
            style={{ background: 'var(--court)' }}
          >
            Start predicting — it&apos;s free
          </Link>
          <Link
            href="/challenges/create"
            className="w-full sm:w-auto px-6 py-3.5 md:px-8 text-sm font-medium rounded-sm border transition-opacity hover:opacity-80 text-center"
            style={{ background: 'white', borderColor: 'var(--chalk-dim)', color: 'var(--ink)' }}
          >
            Challenge a friend
          </Link>
        </div>
      </section>

      {/* ── Live Right Now ─────────────────────────────────────────── */}
      {liveTournaments.length > 0 && (
        <section className="py-8 md:py-12 border-t border-b" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
          <div className="max-w-5xl mx-auto px-4 md:px-8">
            <div className="flex items-center gap-2 mb-5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: '#c84b31', boxShadow: '0 0 0 3px rgba(200,75,49,0.2)', flexShrink: 0 }}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Live right now
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {liveTournaments.map(t => (
                <TournamentCard key={t.id} t={t} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Bracket Preview ────────────────────────────────────────── */}
      <section className="py-12 md:py-20">
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center">
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>
                How it works
              </div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '16px' }}>
                Fill out your bracket before the draw closes
              </h2>
              <p style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: '0.9rem' }}>
                The moment the official draw is published, your window opens. Pick the winner of every match — round by round — and lock in your predictions before each match starts. Back a player all the way to the title and earn compound bonus points through the streak multiplier.
              </p>
              <Link
                href="/signup"
                className="inline-block mt-6 px-6 py-3 text-sm font-medium text-white rounded-sm hover:opacity-90"
                style={{ background: 'var(--court)' }}
              >
                Start free →
              </Link>
            </div>
            <div className="rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              <MockBracketPreview />
            </div>
          </div>
        </div>
      </section>

      {/* ── Leaderboard Teaser ─────────────────────────────────────── */}
      <section className="py-12 md:py-20 border-t" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center">

            {/* Rankings preview */}
            <div style={{ position: 'relative' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>
                Global rankings · Rolling 52 weeks
              </div>
              <div className="rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
                {(topPlayers.length > 0 ? topPlayers : Array.from({ length: 5 })).map((p: any, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-3 border-b last:border-0"
                    style={{
                      borderColor: 'var(--chalk-dim)',
                      filter: i >= 3 ? 'blur(5px)' : 'none',
                      userSelect: i >= 3 ? 'none' : 'auto',
                      pointerEvents: i >= 3 ? 'none' : 'auto',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', minWidth: '24px' }}>
                        #{i + 1}
                      </span>
                      {topPlayers.length > 0 ? (
                        <>
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', color: 'var(--ink)' }}>{p.username}</span>
                          {p.country && nameToFlag(p.country) && (
                            <span style={{ fontSize: '0.85rem', flexShrink: 0 }} title={p.country}>
                              {nameToFlag(p.country)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{
                          fontFamily: 'var(--font-display)', fontSize: '0.95rem',
                          background: 'var(--chalk-dim)', color: 'transparent', borderRadius: '2px',
                          userSelect: 'none',
                        }}>
                          {'─'.repeat(7 + i)}
                        </span>
                      )}
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--court)' }}>
                      {topPlayers.length > 0
                        ? `${p.ranking_points.toLocaleString()} pts`
                        : `${(4800 - i * 620).toLocaleString()} pts`
                      }
                    </span>
                  </div>
                ))}
              </div>
              {/* Gradient fade + CTA */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: '80px',
                background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.97))',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '10px',
              }}>
                <Link
                  href="/signup"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--court)', textDecoration: 'none', letterSpacing: '0.03em' }}
                >
                  Sign up to see full rankings →
                </Link>
              </div>
            </div>

            {/* Copy */}
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>
                Season standings
              </div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '16px' }}>
                Compete across the full 52-week season
              </h2>
              <p style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: '0.9rem' }}>
                Every tournament you predict adds to your rolling annual ranking. The leaderboard runs a 52-week window — consistent accuracy over the whole season beats a single lucky week every time.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {[
                  { stat: '60+', label: 'Tournaments per season' },
                  { stat: 'ATP & WTA', label: 'Both tours, full calendar' },
                ].map((s, i) => (
                  <div key={i} className="px-4 py-4 rounded-sm border" style={{ borderColor: 'var(--chalk-dim)', background: 'var(--chalk)' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.02em', color: 'var(--court)' }}>{s.stat}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '3px', lineHeight: 1.4 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────── */}
      <section className="py-12 md:py-20 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <div className="text-center mb-10 md:mb-14">
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>
              Everything in one place
            </div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Built for serious tennis fans
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px" style={{ background: 'var(--chalk-dim)', border: '1px solid var(--chalk-dim)' }}>
            {[
              {
                n: '01',
                label: 'Real ATP & WTA points',
                desc: 'Your correct picks earn points using the exact same formula as the real tour. A Grand Slam winner pick is worth 2,000 points — the same as the actual champion earns.',
              },
              {
                n: '02',
                label: 'The full calendar',
                desc: 'All 60+ ATP and WTA tournaments from Melbourne to Miami, automatically synced the moment official draws are published. Nothing is manual.',
              },
              {
                n: '03',
                label: 'Streak multiplier',
                desc: 'Back a player across consecutive rounds and earn compound bonus points. Predict Alcaraz through 5 straight rounds correctly and the multiplier stacks on top.',
              },
              {
                n: '04',
                label: 'Private leagues',
                desc: 'Create a group, share the invite code, and see who rules your circle through the full season. Filter standings by Grand Slams only or across the full calendar.',
              },
              {
                n: '05',
                label: 'Head-to-head challenges',
                desc: 'Send a bracket link to anyone — no account needed on their end. They fill in their picks, you both lock in, and the results settle the argument.',
              },
              {
                n: '06',
                label: 'Worldwide rankings',
                desc: 'See where you stand globally, in your country, and in your city. Rankings roll over a 52-week window — sustained accuracy beats a single lucky Grand Slam.',
              },
            ].map((f, i) => (
              <div key={i} className="px-6 py-8 md:px-8 md:py-10" style={{ background: 'var(--chalk)' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--court)', fontFamily: 'var(--font-mono)' }}>
                  {f.n}
                </div>
                <div className="font-medium mb-2" style={{ fontSize: '0.95rem', color: 'var(--ink)' }}>{f.label}</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: '1.7' }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────── */}
      <section className="py-16 md:py-24 border-t text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 5vw, 3.5rem)', letterSpacing: '-0.02em', lineHeight: 1.05, marginBottom: '20px' }}>
            The full season starts now.
          </h2>
          <p style={{ color: 'var(--muted)', maxWidth: '36ch', margin: '0 auto 2rem', lineHeight: 1.7, fontSize: '0.9rem' }}>
            Create your free account and make your first picks before the next draw closes.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 text-sm font-medium text-white rounded-sm hover:opacity-90"
            style={{ background: 'var(--court)' }}
          >
            Start predicting — it&apos;s free
          </Link>
        </div>
      </section>

    </main>
  )
}
