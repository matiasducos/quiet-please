'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { rateLimit } from '@/lib/rate-limit'
import { trackServerEvent } from '@/lib/posthog/server'
import { TERMS_VERSION, MINIMUM_AGE } from '@/lib/legal/terms'

export async function setUsername(
  username: string,
  consented: boolean,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const rl = rateLimit(`set-username:${user.id}`, { maxRequests: 5, windowMs: 60_000 })
  if (rl.limited) return { error: `Too many attempts. Try again in ${rl.retryAfter}s.` }

  // Re-checked server-side rather than trusting the disabled button: this action
  // is reachable directly, and an account that reaches the app without a consent
  // row is precisely the state the whole feature exists to prevent.
  if (consented !== true) {
    return { error: `Please confirm you are ${MINIMUM_AGE} or older and accept the Terms and Privacy Policy.` }
  }

  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (clean.length < 3) return { error: 'Username must be at least 3 characters.' }
  if (clean.length > 20) return { error: 'Username must be 20 characters or fewer.' }

  // Check uniqueness (admin client bypasses RLS)
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('username', clean)
    .neq('id', user.id)
    .single()

  if (existing) return { error: 'That username is already taken.' }

  // Consent is written in the same statement that flips username_is_set, so a
  // user can never end up past this gate with the flag set but no consent row —
  // two separate writes could be interrupted between them.
  const acceptedAt = new Date().toISOString()
  const { error } = await admin
    .from('users')
    .update({
      username: clean,
      username_is_set: true,
      terms_accepted_at: acceptedAt,
      terms_version: TERMS_VERSION,
      // Same tick, same timestamp: the checkbox label states both the age
      // representation and the Terms/Privacy acceptance explicitly.
      age_confirmed_at: acceptedAt,
    })
    .eq('id', user.id)

  if (error) return { error: error.message }

  // The one reliable "account created" moment. Every user passes through this
  // screen exactly once, gated on username_is_set going false → true, so this
  // fires once per real account and never for a returning login. The obvious
  // alternatives are both wrong: /signup submit fires before email
  // confirmation (counting people who never come back), and /auth/callback
  // fires on every OAuth sign-in, not just the first.
  trackServerEvent(user.id, 'signup_completed', {
    username: clean,
    // OAuth users arrive with a verified address already; email signups only
    // reach here after clicking the confirmation link. Distinguishing them
    // shows which route actually converts.
    provider: user.app_metadata?.provider ?? 'email',
  })

  revalidatePath('/dashboard')
  return {}
}
