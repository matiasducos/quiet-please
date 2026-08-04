import { NextResponse, type NextRequest } from 'next/server'
import {
  CONSENT_COOKIE_NAME,
  CONSENT_COOKIE_MAX_AGE,
  serializeConsent,
  type ConsentDecision,
} from '@/lib/consent'
import {
  ATTRIBUTION_COOKIE_NAME,
  ATTRIBUTION_COOKIE_MAX_AGE,
  deriveAttribution,
  isLandingCandidate,
  serializeAttribution,
} from '@/lib/attribution'

/**
 * Records a cookie-consent decision.
 *
 * Why this exists rather than the banner just writing a cookie in JS: the
 * first grant has to back-fill attribution. Middleware refuses to write
 * `qp_attr` before consent, so by the time a visitor accepts, the landing
 * request that carried their utm params and referrer is already over. The
 * banner posts the page it was accepted on and its referrer, and the same
 * derivation runs here.
 *
 * Accepting on the landing page — the overwhelmingly common case, since the
 * banner appears immediately — therefore attributes exactly. Wandering the
 * site first and accepting later keeps whatever the current URL still
 * carries, which is usually nothing. That loss is inherent to asking first,
 * not a defect of this route.
 */
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { decision, url, referrer } = (body ?? {}) as {
    decision?: string
    url?: string
    referrer?: string | null
  }

  if (decision !== 'granted' && decision !== 'denied') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 })
  }

  const response = NextResponse.json({ ok: true })
  const secure = process.env.NODE_ENV === 'production'

  response.cookies.set(CONSENT_COOKIE_NAME, serializeConsent(decision as ConsentDecision), {
    path: '/',
    httpOnly: false, // the banner and the PostHog client both read it
    secure,
    sameSite: 'lax',
    maxAge: CONSENT_COOKIE_MAX_AGE,
  })

  if (decision === 'denied') {
    // Withdrawal has to actually remove what was stored, not just stop adding
    // to it. A visitor who declines after previously accepting must end up
    // with nothing non-essential left on their device.
    response.cookies.delete(ATTRIBUTION_COOKIE_NAME)
    response.cookies.delete('qp_ref')
    return response
  }

  if (!request.cookies.has(ATTRIBUTION_COOKIE_NAME)) {
    // The client reports which page it accepted on. Constrained to our own
    // origin so a crafted body can't invent a landing path — the utm values
    // themselves are visitor-controlled either way (anyone can append
    // ?utm_source=), but the path should still be one of ours.
    let pageUrl: URL | null = null
    try {
      const candidate = new URL(String(url), request.nextUrl.origin)
      if (candidate.origin === request.nextUrl.origin) pageUrl = candidate
    } catch {
      // Fall through — no attribution rather than a bad one.
    }

    if (pageUrl && isLandingCandidate(pageUrl.pathname)) {
      const attribution = deriveAttribution(pageUrl, typeof referrer === 'string' && referrer ? referrer : null)
      if (attribution) {
        response.cookies.set(ATTRIBUTION_COOKIE_NAME, serializeAttribution(attribution), {
          path: '/',
          httpOnly: true,
          secure,
          sameSite: 'lax',
          maxAge: ATTRIBUTION_COOKIE_MAX_AGE,
        })
      }
    }
  }

  return response
}
