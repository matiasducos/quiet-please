'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const STORAGE_KEY = 'qp_tour_completed'

const STEPS = [
  {
    target: 'stats',
    title: 'Your season at a glance',
    body: 'Track your ranking points, prediction count, and global position. These update after every match result.',
  },
  {
    target: 'nav-tournaments',
    title: 'Tournaments',
    body: 'Browse all ATP and WTA tournaments. When a draw opens, fill in your bracket — correct picks earn points that count toward the global leaderboard.',
  },
  {
    target: 'nav-leaderboard',
    title: 'Leaderboard',
    body: 'See how you rank globally and per tournament. Rankings use a rolling 52-week window — stay consistent to climb.',
  },
  {
    target: 'nav-leagues',
    title: 'Leagues',
    body: 'Create or join private leagues to compete with friends, colleagues, or communities. Each league has its own leaderboard and season.',
  },
  {
    target: 'nav-challenges',
    title: 'Challenges',
    body: 'Go head-to-head with a friend on any tournament. You each lock in your bracket — whoever scores more points wins. Challenge points are separate from your global ranking.',
  },
]

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export default function DashboardTour() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const [tooltipPos, setTooltipPos] = useState<'below' | 'above'>('below')
  const tooltipRef = useRef<HTMLDivElement>(null)

  // Check localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem(STORAGE_KEY)) {
      // Small delay so the page renders first
      const timer = setTimeout(() => setVisible(true), 600)
      return () => clearTimeout(timer)
    }
  }, [])

  const measureTarget = useCallback(() => {
    const currentStep = STEPS[step]
    if (!currentStep) return

    const el = document.querySelector(`[data-tour="${currentStep.target}"]`)
    if (!el) {
      // Target doesn't exist (e.g. no live tournaments) — skip to next
      if (step < STEPS.length - 1) {
        setStep(s => s + 1)
      } else {
        completeTour()
      }
      return
    }

    const rect = el.getBoundingClientRect()
    const scrollY = window.scrollY

    setTargetRect({
      top: rect.top + scrollY,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    })

    // Position tooltip below if there's room, otherwise above
    const spaceBelow = window.innerHeight - rect.bottom
    setTooltipPos(spaceBelow > 220 ? 'below' : 'above')

    // Scroll target into view if offscreen
    if (rect.top < 80 || rect.bottom > window.innerHeight - 40) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Re-measure after scroll
      requestAnimationFrame(() => {
        const newRect = el.getBoundingClientRect()
        const newScrollY = window.scrollY
        setTargetRect({
          top: newRect.top + newScrollY,
          left: newRect.left,
          width: newRect.width,
          height: newRect.height,
        })
      })
    }
  }, [step])

  useEffect(() => {
    if (!visible) return
    measureTarget()
    window.addEventListener('resize', measureTarget)
    return () => window.removeEventListener('resize', measureTarget)
  }, [visible, step, measureTarget])

  function completeTour() {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      completeTour()
    }
  }

  function handleBack() {
    if (step > 0) setStep(s => s - 1)
  }

  if (!visible || !targetRect) return null

  const currentStep = STEPS[step]
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const padding = 8

  // Spotlight cutout dimensions (with padding around target)
  const spotTop = targetRect.top - padding
  const spotLeft = Math.max(0, targetRect.left - padding)
  const spotWidth = Math.min(targetRect.width + padding * 2, window.innerWidth)
  const spotHeight = targetRect.height + padding * 2

  // Tooltip position
  const tooltipLeft = isMobile ? 16 : Math.max(16, Math.min(targetRect.left, window.innerWidth - 380))
  const tooltipWidth = isMobile ? 'calc(100vw - 32px)' : '360px'
  const tooltipTop = tooltipPos === 'below'
    ? spotTop + spotHeight + 12
    : spotTop - 12

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      {/* Backdrop with spotlight cutout using CSS clip-path */}
      <div
        onClick={completeTour}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          clipPath: `polygon(
            0% 0%, 100% 0%, 100% 100%, 0% 100%,
            0% ${spotTop}px,
            ${spotLeft}px ${spotTop}px,
            ${spotLeft}px ${spotTop + spotHeight}px,
            ${spotLeft + spotWidth}px ${spotTop + spotHeight}px,
            ${spotLeft + spotWidth}px ${spotTop}px,
            0% ${spotTop}px
          )`,
          cursor: 'pointer',
        }}
      />

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          top: tooltipPos === 'below' ? tooltipTop : undefined,
          bottom: tooltipPos === 'above' ? `calc(100vh - ${tooltipTop}px)` : undefined,
          left: tooltipLeft,
          width: tooltipWidth,
          background: 'white',
          borderRadius: '6px',
          padding: '20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          zIndex: 61,
        }}
      >
        {/* Step indicator */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: '20px',
                height: '3px',
                borderRadius: '2px',
                background: i === step ? 'var(--court)' : 'var(--chalk-dim)',
                transition: 'background 0.2s',
              }}
            />
          ))}
        </div>

        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.1rem',
          letterSpacing: '-0.01em',
          marginBottom: '6px',
          color: 'var(--ink)',
        }}>
          {currentStep.title}
        </h3>

        <p style={{
          fontSize: '0.85rem',
          lineHeight: 1.55,
          color: 'var(--muted)',
          marginBottom: '16px',
        }}>
          {currentStep.body}
        </p>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={completeTour}
            style={{
              fontSize: '0.75rem',
              color: 'var(--muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Skip tour
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            {step > 0 && (
              <button
                onClick={handleBack}
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--muted)',
                  background: 'white',
                  border: '1px solid var(--chalk-dim)',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  padding: '6px 14px',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              style={{
                fontSize: '0.8rem',
                color: 'white',
                background: 'var(--court)',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer',
                padding: '6px 16px',
                fontWeight: 500,
              }}
            >
              {step === STEPS.length - 1 ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Call this to restart the tour (e.g. from profile page) */
export function resetTour() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
}
