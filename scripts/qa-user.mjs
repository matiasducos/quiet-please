/**
 * Provision and sign in to the QA verification account.
 *
 * Why this exists: the in-app browser Claude drives has no session, so every
 * signed-in surface — the admin panel, /predict, leaderboards, the "Your
 * tournament" panel — ships typechecked and built but never actually seen.
 * This account is the session it can borrow.
 *
 * The address is on @bot.quietplease.app on purpose. `isBotEmail()`
 * (src/lib/email.ts) is checked in all three cron routes and the shared email
 * helper, so a user on that domain can never be sent mail — award-points,
 * auto-predict and draw announcements can all be triggered against it without
 * anything reaching a real inbox.
 *
 * No password is ever set. The account signs in through a one-time magic link
 * minted below, which means there is no credential to store, leak, or rotate.
 *
 *   node scripts/qa-user.mjs status       # does it exist, and what is its id
 *   node scripts/qa-user.mjs create       # provision it (run once)
 *   node scripts/qa-user.mjs login-link   # mint a fresh sign-in link
 *
 * NOTE: there is one database. `.env.local` holds production credentials, so
 * `create` writes a real row to the live project — that is unavoidable and is
 * why the bot domain matters.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const envPath = resolve(import.meta.dirname, '..', '.env.local')
const envFile = readFileSync(envPath, 'utf-8')
const env = Object.fromEntries(
  envFile.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const [k, ...rest] = l.split('=')
    return [k.trim(), rest.join('=').trim()]
  })
)

const QA_EMAIL = 'qa@bot.quietplease.app'
const QA_USERNAME = 'qabot'

// Where the magic link lands. Local by default because the whole point is to
// drive a dev server; pass an origin to sign in against a deployed environment.
// Whatever is used must be in Supabase's allowed redirect URLs.
const redirectOrigin = process.argv[3] ?? 'http://localhost:3000'

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/**
 * The QA user's auth row, or null.
 *
 * Filtered server-side rather than by paging listUsers: that helper is capped
 * at perPage 25 by a Supabase-side fault (PR #82), so scanning for one address
 * across a growing user base would silently stop finding it.
 */
async function findQaUser() {
  const { data, error } = await admin
    .from('users')
    .select('id, username, email, username_is_set')
    .eq('email', QA_EMAIL)
    .maybeSingle()
  if (error) throw new Error(`lookup failed: ${error.message}`)
  return data
}

async function status() {
  const user = await findQaUser()
  if (!user) {
    console.log(`✗ ${QA_EMAIL} does not exist yet — run: node scripts/qa-user.mjs create`)
    return
  }
  console.log(`✓ ${QA_EMAIL}`)
  console.log(`  id:       ${user.id}`)
  console.log(`  username: ${user.username}${user.username_is_set ? '' : '  (username_is_set is false)'}`)
  console.log()
  console.log(`  For admin access in production, add to ADMIN_USER_IDS:`)
  console.log(`    ${user.id}`)
  console.log(`  Not needed locally — requireAdmin() passes any signed-in user in development.`)
}

async function create() {
  const existing = await findQaUser()
  if (existing) {
    console.log(`Already exists (${existing.id}) — nothing to do.`)
    return status()
  }

  // No password field: this account can only ever be entered through a link
  // minted by the service role, so there is no credential in circulation.
  // email_confirm skips the confirmation mail that isBotEmail would drop anyway.
  const { data, error } = await admin.auth.admin.createUser({
    email: QA_EMAIL,
    email_confirm: true,
    user_metadata: { username: QA_USERNAME },
  })
  if (error) throw new Error(`createUser failed: ${error.message}`)
  console.log(`✓ created auth user ${data.user.id}`)

  // handle_new_user() (migration 001) inserts the public.users row from the
  // trigger, so it already exists by the time createUser returns. This is the
  // /setup-username step, which the account never walks through interactively.
  const { error: profileError } = await admin
    .from('users')
    .update({ username: QA_USERNAME, username_is_set: true })
    .eq('id', data.user.id)
  if (profileError) throw new Error(`profile update failed: ${profileError.message}`)
  console.log(`✓ username set to ${QA_USERNAME}`)
  console.log()
  await status()
}

async function loginLink() {
  const user = await findQaUser()
  if (!user) throw new Error(`${QA_EMAIL} does not exist — run: node scripts/qa-user.mjs create`)

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: QA_EMAIL,
  })
  if (error) throw new Error(`generateLink failed: ${error.message}`)

  // The hashed_token, not the action_link. action_link goes through Supabase's
  // own /verify endpoint, which enforces the project's redirect allow-list —
  // localhost is not on it, so every local target silently falls back to the
  // production Site URL and the session lands on the wrong origin. /auth/confirm
  // redeems the token server-side instead, which the allow-list never sees.
  const link = new URL('/auth/confirm', redirectOrigin)
  link.searchParams.set('token_hash', data.properties.hashed_token)
  link.searchParams.set('next', '/dashboard')

  console.log('One-time sign-in link (expires, single use):')
  console.log()
  console.log(link.toString())
  console.log()
  console.log(`Open it in the Browser pane. It lands on ${redirectOrigin}/dashboard signed in as ${QA_USERNAME}.`)
  console.log('/auth/confirm is development-only — it 404s anywhere else.')
}

const command = process.argv[2] ?? 'status'
const commands = { status, create, 'login-link': loginLink }

if (!commands[command]) {
  console.error(`Unknown command "${command}". Use: status | create | login-link`)
  process.exit(1)
}

await commands[command]().catch(err => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
