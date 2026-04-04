'use client'

import { useState, useEffect, type ReactNode } from 'react'

const STEPS = [
  {
    label: 'Pick a tournament',
    description: 'Choose any ATP or WTA event when the draw opens.',
    key: 'tournament',
  },
  {
    label: 'Fill your bracket',
    description: 'Pick who wins each match — from Round 1 to the Final.',
    key: 'bracket',
  },
  {
    label: 'Earn points',
    description: 'Correct picks earn points. Consecutive picks on the same player multiply your score.',
    key: 'points',
  },
  {
    label: 'Climb the ranking',
    description: 'Your points roll into a 52-week global leaderboard.',
    key: 'ranking',
  },
]

const AUTO_CYCLE_MS = 5000
const PAUSE_AFTER_CLICK_MS = 15000

function TournamentMock() {
  const tournaments = [
    { flag: '\u{1f1fa}\u{1f1f8}', name: 'Houston, United States', tour: 'ATP', category: 'ATP 250', status: 'In progress', highlight: false },
    { flag: '\u{1f1f2}\u{1f1e6}', name: 'Marrakech, Morocco', tour: 'ATP', category: 'ATP 250', status: 'In progress', highlight: false },
    { flag: '\u{1f1fa}\u{1f1f8}', name: 'Charleston, United States', tour: 'WTA', category: 'WTA 500', status: 'Predict now', highlight: true },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {tournaments.map((t, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'white', border: '1px solid #e8e3d8', borderRadius: '2px', padding: '10px 14px',
          opacity: t.highlight ? 1 : 0.5,
          transform: t.highlight ? 'scale(1.02)' : 'scale(1)',
          transition: 'all 0.4s ease',
          boxShadow: t.highlight ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', background: t.tour === 'WTA' ? '#fbeaf0' : '#e6f1fb', color: t.tour === 'WTA' ? '#993556' : '#185FA5', padding: '2px 6px', borderRadius: '2px' }}>{t.category}</span>
            <span style={{ fontSize: '0.8rem' }}>{t.flag} {t.name}</span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: t.highlight ? '#1a6b3c' : '#6b6b6b', fontWeight: t.highlight ? 600 : 400 }}>
            {t.status} {t.highlight ? '\u2192' : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

function BracketMock() {
  const matches = [
    { p1: 'C. Alcaraz', p2: 'A. Rublev', s1: 1, s2: 5, picked: 1 },
    { p1: 'J. Sinner', p2: 'S. Tsitsipas', s1: 2, s2: 6, picked: 1 },
    { p1: 'D. Medvedev', p2: 'T. Fritz', s1: 3, s2: 8, picked: 2 },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: '#6b6b6b', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '4px' }}>Round of 16</div>
      {matches.map((m, i) => (
        <div key={i} style={{ background: 'white', border: '1px solid #e8e3d8', borderRadius: '2px', overflow: 'hidden' }}>
          {[{ name: m.p1, seed: m.s1, isPicked: m.picked === 1, isTop: true }, { name: m.p2, seed: m.s2, isPicked: m.picked === 2, isTop: false }].map((p, j) => (
            <div key={j} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', background: p.isPicked ? '#eaf3de' : 'white',
              borderBottom: p.isTop ? '1px solid #e8e3d8' : 'none',
            }}>
              <span style={{ fontSize: '0.8rem' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: '#6b6b6b', marginRight: '6px' }}>[{p.seed}]</span>
                {p.name}
              </span>
              {p.isPicked && <span style={{ color: '#1a6b3c', fontSize: '0.75rem', fontWeight: 600 }}>{'\u2713'}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function PointsMock() {
  const rows = [
    { round: 'R1', player: 'C. Alcaraz', streak: null, pts: '+10 pts' },
    { round: 'R2', player: 'C. Alcaraz', streak: '2x STREAK', pts: '+90 pts' },
    { round: 'QF', player: 'C. Alcaraz', streak: '3x STREAK', pts: '+540 pts' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', border: '1px solid #e8e3d8', borderRadius: '2px', padding: '10px 14px' }}>
          <div>
            <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{r.round} — {r.player}</span>
            {r.streak && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: '#c17c00', marginLeft: '8px', background: '#fef3cd', padding: '1px 5px', borderRadius: '2px' }}>{r.streak}</span>}
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#1a6b3c', fontWeight: 600 }}>{r.pts}</span>
        </div>
      ))}
      <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#6b6b6b', marginTop: '4px' }}>
        Streak multiplier compounds — picking the same player through deep rounds pays off big.
      </div>
    </div>
  )
}

function RankingMock() {
  const rows = [
    { rank: 1, name: 'tennisfan22', pts: '8,420', highlight: false },
    { rank: 2, name: 'acepredictor', pts: '7,105', highlight: false },
    { rank: 3, name: 'you', pts: '5,640', highlight: true },
    { rank: 4, name: 'slamwinner', pts: '4,890', highlight: false },
  ]
  const medals = ['\u{1f947}', '\u{1f948}', '\u{1f949}']
  return (
    <div style={{ background: 'white', border: '1px solid #e8e3d8', borderRadius: '2px', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr auto', padding: '8px 14px', borderBottom: '1px solid #e8e3d8', background: '#fafaf8' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: '#6b6b6b', letterSpacing: '0.06em' }}>RANK</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: '#6b6b6b', letterSpacing: '0.06em' }}>PLAYER</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: '#6b6b6b', letterSpacing: '0.06em' }}>POINTS</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '40px 1fr auto',
          padding: '10px 14px', borderBottom: '1px solid #e8e3d8',
          background: r.highlight ? '#eaf3de' : 'white',
        }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: i < 3 ? '#c17c00' : '#6b6b6b' }}>
            {medals[i] ?? r.rank}
          </span>
          <span style={{ fontSize: '0.85rem', fontWeight: r.highlight ? 600 : 400, color: r.highlight ? '#1a6b3c' : '#0d0d0d' }}>
            {r.name}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 500 }}>{r.pts}</span>
        </div>
      ))}
    </div>
  )
}

const MOCK_COMPONENTS: Record<string, () => ReactNode> = {
  tournament: TournamentMock,
  bracket: BracketMock,
  points: PointsMock,
  ranking: RankingMock,
}

export default function HowItWorksDemo() {
  const [activeStep, setActiveStep] = useState(0)
  const [pausedUntil, setPausedUntil] = useState(0)

  function handleStepClick(i: number) {
    setActiveStep(i)
    setPausedUntil(Date.now() + PAUSE_AFTER_CLICK_MS)
  }

  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() < pausedUntil) return
      setActiveStep(s => (s + 1) % STEPS.length)
    }, AUTO_CYCLE_MS)
    return () => clearInterval(timer)
  }, [pausedUntil])

  const MockComponent = MOCK_COMPONENTS[STEPS[activeStep].key]

  return (
    <div>
      <div style={{ display: 'flex', gap: '0', marginBottom: '0', borderBottom: '1px solid #e8e3d8' }}>
        {STEPS.map((step, i) => (
          <button
            key={i}
            onClick={() => handleStepClick(i)}
            style={{
              flex: 1, padding: '12px 8px', background: 'none', border: 'none',
              borderBottom: i === activeStep ? '2px solid #1a6b3c' : '2px solid transparent',
              cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.08em', color: i === activeStep ? '#1a6b3c' : '#6b6b6b', textTransform: 'uppercase', marginBottom: '2px' }}>
              Step {i + 1}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.8rem', color: i === activeStep ? '#0d0d0d' : '#6b6b6b', letterSpacing: '-0.01em' }}>
              {step.label}
            </div>
          </button>
        ))}
      </div>

      <div style={{ background: '#fafaf8', border: '1px solid #e8e3d8', borderTop: 'none', borderRadius: '0 0 2px 2px', padding: '20px 16px', minHeight: '260px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#6b6b6b', marginBottom: '14px', letterSpacing: '0.02em' }}>
          {STEPS[activeStep].description}
        </p>
        <MockComponent />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '12px' }}>
        {STEPS.map((_, i) => (
          <div
            key={i}
            onClick={() => handleStepClick(i)}
            style={{
              width: i === activeStep ? '20px' : '6px', height: '6px', borderRadius: '3px',
              background: i === activeStep ? '#1a6b3c' : '#d4d0c8',
              transition: 'all 0.3s ease', cursor: 'pointer',
            }}
          />
        ))}
      </div>
    </div>
  )
}
