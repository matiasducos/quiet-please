/**
 * The multiplier celebration — the moment a pick becomes worth more than base.
 *
 * Imperative DOM on purpose. Everything it draws is injected, animated and
 * removed by this module; it never touches a node React owns, so there is no
 * render to fight over. The one exception is the badge, which it covers with a
 * counting clone and then uncovers — by which point React has already rendered
 * the same final value underneath, so the swap is invisible.
 *
 * Escalates by adding stages rather than volume, so the ladder stays legible:
 *
 *   ×1        nothing at all. Silence is what makes ×2 register.
 *   ×2        one feeder link lights, the value counts up
 *   ×3        two links, and the badge pops
 *   ×4        + a ring pulse around the card
 *   ×5 and up + a spark burst from the badge
 *
 * ×6 and ×7 exist at a slam and deliberately reuse the ×5 treatment: two more
 * tiers nobody sees twice would cost more than they are worth.
 */

/** Segments the chain rail will draw, and the tier the treatment tops out at. */
const MAX_LINKS = 4
const TOP_TIER = 5

/**
 * Rapid picking must not become a hundred celebrations.
 *
 * Filling a fresh bracket is the worst case by far: before a tournament starts
 * nothing is decided, so *every* deep pick carries a big multiplier — an R16
 * pick is ×4, a final ×7 — and someone laying out all 127 in one sitting would
 * otherwise set off a celebration per click. A single gate on elapsed time
 * turns that into a handful, and leaves a deliberate one-off pick untouched.
 */
const MIN_GAP_MS = 900
let lastCelebrationAt = 0

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function celebrateMultiplier(matchId: string, mult: number, basePoints: number | null): void {
  if (typeof document === 'undefined') return
  if (mult < 2) return
  if (prefersReducedMotion()) return

  const now = Date.now()
  if (now - lastCelebrationAt < MIN_GAP_MS) return
  lastCelebrationAt = now

  const card = document.querySelector<HTMLElement>(`[data-mc="${CSS.escape(matchId)}"]`)
  if (!card) return
  const badge = card.querySelector<HTMLElement>('[data-badge]')

  const tier = Math.min(mult, TOP_TIER)
  const court = token('--court', '#1a6b3c')
  const clay = token('--clay', '#c8530a')

  // ── the chain rail: one segment per round below that is still in play ──
  const links = Math.min(mult - 1, MAX_LINKS)
  const rail = document.createElement('div')
  rail.setAttribute('aria-hidden', 'true')
  Object.assign(rail.style, {
    position: 'absolute', left: '10px', right: '10px', top: '0px', height: '2px',
    display: 'flex', gap: '3px', pointerEvents: 'none', zIndex: '3',
  } as CSSStyleDeclaration)
  for (let i = 0; i < links; i++) {
    const seg = document.createElement('span')
    Object.assign(seg.style, {
      flex: '1', height: '2px', borderRadius: '2px', background: court,
      opacity: '0', transformOrigin: 'left center',
    } as CSSStyleDeclaration)
    rail.appendChild(seg)
    seg.animate(
      [{ opacity: 0, transform: 'scaleX(0)' },
       { opacity: 1, transform: 'scaleX(1)', offset: 0.35 },
       { opacity: 1, transform: 'scaleX(1)', offset: 0.75 },
       { opacity: 0, transform: 'scaleX(1)' }],
      { duration: 620, delay: i * 110, easing: 'cubic-bezier(.2,.9,.3,1)' },
    )
  }
  card.appendChild(rail)
  const railEndsAt = links * 110 + 620

  // ── the value counting up over the badge ──
  if (badge && basePoints !== null && basePoints > 0) {
    const box = badge.getBoundingClientRect()
    const cardBox = card.getBoundingClientRect()
    const clone = document.createElement('span')
    clone.setAttribute('aria-hidden', 'true')
    const cs = getComputedStyle(badge)
    Object.assign(clone.style, {
      position: 'absolute',
      left: `${box.left - cardBox.left}px`, top: `${box.top - cardBox.top}px`,
      height: `${box.height}px`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      font: cs.font, letterSpacing: cs.letterSpacing, color: cs.color,
      background: cs.backgroundColor, padding: cs.padding, borderRadius: cs.borderRadius,
      whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: '4',
      fontVariantNumeric: 'tabular-nums',
    } as CSSStyleDeclaration)
    card.appendChild(clone)

    const from = basePoints, to = basePoints * mult
    const dur = 380 + tier * 80
    clone.textContent = `×${mult} · ${from.toLocaleString()} PTS`

    // Every injected node gets a removal that does not depend on the animation
    // finishing. requestAnimationFrame does not run at all while the document
    // is hidden, so a cleanup living inside the loop leaves the clone sitting
    // on top of the badge until the tab is looked at again.
    const hardStop = setTimeout(() => clone.remove(), dur + 900)

    const t0 = performance.now()
    const step = (t: number) => {
      if (!clone.isConnected) return
      const k = Math.min(1, (t - t0) / dur)
      const eased = 1 - Math.pow(1 - k, 3)
      const val = Math.round(from + (to - from) * eased)
      clone.textContent = `×${mult} · ${val.toLocaleString()} PTS`
      if (k < 1) { requestAnimationFrame(step); return }
      if (tier >= 3) {
        clone.animate(
          [{ transform: 'scale(1)' }, { transform: `scale(${1 + tier * 0.045})` }, { transform: 'scale(1)' }],
          { duration: 380, easing: 'cubic-bezier(.2,1.4,.4,1)' },
        )
      }
      clearTimeout(hardStop)
      setTimeout(() => clone.remove(), tier >= 3 ? 400 : 60)
    }
    requestAnimationFrame(step)
  }

  // ── ×4: a ring pulse around the card ──
  if (tier >= 4) {
    card.animate(
      [{ boxShadow: `0 0 0 0 ${court}66` }, { boxShadow: `0 0 0 ${tier * 4}px ${court}00` }],
      { duration: 620, delay: railEndsAt - 200, easing: 'ease-out' },
    )
  }

  // ── ×5+: a spark burst from the badge ──
  if (tier >= TOP_TIER && badge) {
    burst(card, badge, court, clay, tier, railEndsAt - 220)
  }

  setTimeout(() => rail.remove(), railEndsAt + 80)
}

/**
 * Canvas rather than spawned nodes: forty particles is one element and one
 * paint, not forty of each on a page that already renders 127 match cards.
 */
function burst(
  card: HTMLElement, badge: HTMLElement,
  court: string, clay: string, tier: number, delay: number,
): void {
  setTimeout(() => {
    const cardBox = card.getBoundingClientRect()
    const cv = document.createElement('canvas')
    cv.setAttribute('aria-hidden', 'true')
    cv.width = Math.max(1, Math.round(cardBox.width))
    cv.height = Math.max(1, Math.round(cardBox.height))
    Object.assign(cv.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '2',
    } as CSSStyleDeclaration)
    card.appendChild(cv)

    const ctx = cv.getContext('2d')
    if (!ctx) { cv.remove(); return }
    const b = badge.getBoundingClientRect()
    const ox = b.left - cardBox.left + b.width / 2
    const oy = b.top - cardBox.top + b.height / 2

    const parts = Array.from({ length: 10 + tier * 6 }, () => {
      const a = Math.random() * Math.PI * 2
      const sp = 0.8 + Math.random() * (0.9 + tier * 0.35)
      return {
        x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.5,
        r: 1.2 + Math.random() * 1.8, life: 1,
        c: Math.random() < 0.78 ? court : clay,
      }
    })

    const hardStop = setTimeout(() => cv.remove(), 2200)
    let last = performance.now()
    const t0 = last
    const frame = (t: number) => {
      const dt = Math.min(32, t - last); last = t
      ctx.clearRect(0, 0, cv.width, cv.height)
      let alive = false
      for (const p of parts) {
        p.life -= dt / (700 + tier * 60)
        if (p.life <= 0) continue
        alive = true
        p.x += p.vx * dt * 0.06
        p.y += p.vy * dt * 0.06
        p.vy += dt * 0.0016              // settles instead of drifting off
        ctx.globalAlpha = Math.max(0, p.life)
        ctx.fillStyle = p.c
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
      if (alive && t - t0 < 1600) { requestAnimationFrame(frame); return }
      clearTimeout(hardStop)
      cv.remove()
    }
    requestAnimationFrame(frame)
  }, Math.max(0, delay))
}
