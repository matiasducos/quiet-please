import { cache } from 'react'
import { createClient } from './server'

export type NavProfile = {
  username: string
  ranking_points: number
  deletion_requested_at: string | null
}

/**
 * The signed-in user's id for a page render, verified WITHOUT a network call.
 *
 * `auth.getUser()` asks Supabase's auth server on every call — a full round
 * trip before a page can run its first query, on every navigation. The project
 * signs its JWTs with an asymmetric key (ES256; see /auth/v1/.well-known/jwks.json),
 * so `getClaims()` verifies the token's signature locally against a public key
 * that auth-js caches module-wide for ten minutes. Middleware has already run
 * `getUser()` at the edge for this request, which is also what refreshes an
 * expired token, so by the time a page reads the session it is current.
 *
 * What is given up: `getUser()` would also notice a session revoked on the
 * server in the last hour, before its JWT expires. That is Supabase's own
 * recommended trade for reads. It is NOT made for writes — server actions,
 * API routes and the admin gate still call `getUser()`, and RLS checks the
 * same JWT either way.
 *
 * Deduplicated per request, so Nav, the page and anything else share one check.
 */
export const getSessionUser = cache(async (): Promise<{ id: string } | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  // A signed-out visitor is a missing session, not an error worth a log line.
  if (error && error.name !== 'AuthSessionMissingError') {
    console.error('[auth] getClaims failed:', error.message)
  }
  const sub = data?.claims?.sub
  return sub ? { id: sub } : null
})

/**
 * Fetch the current user's nav profile (username + ranking_points).
 * Deduplicated per request via React.cache() — multiple calls in the
 * same RSC render tree only hit the DB once.
 *
 * Returns null if not authenticated.
 */
export const getNavProfile = cache(async (): Promise<{
  user: { id: string } | null
  profile: NavProfile | null
}> => {
  const user = await getSessionUser()
  if (!user) return { user: null, profile: null }

  const supabase = await createClient()
  const { data: profile, error } = await supabase
    .from('users')
    .select('username, ranking_points, deletion_requested_at')
    .eq('id', user.id)
    .single()
  // PGRST116 is "no row": an account mid-onboarding, before its username exists.
  if (error && error.code !== 'PGRST116') console.error('[nav] profile read failed:', error.message)

  return { user, profile }
})
