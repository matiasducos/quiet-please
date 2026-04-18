/**
 * Referrals — invite-a-friend feature logic.
 *
 * Three entry points:
 *  1. `processReferralSignup` — called from auth callback after a new user
 *     completes signup. Resolves the ?ref cookie → inviter, records the
 *     referral, and auto-accepts a friendship between the two.
 *  2. `markReferralFirstPrediction` — called from savePrediction after an
 *     invitee submits their first global prediction. Sets
 *     referrals.first_prediction_at, then awards the Recruiter tier the
 *     inviter just unlocked (if any) and fires a `referral_joined`
 *     notification to the inviter.
 *  3. `getReferralStats` — read helper for the /invite page counter.
 *
 * All writes go through the admin client (service role).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { insertNotifications } from '@/lib/notifications'
import { awardAchievement } from '@/lib/achievements/check'
import { notifyAchievements } from '@/lib/achievements/notify'

type AdminClient = SupabaseClient

export const REFERRAL_COOKIE_NAME = 'qp_ref'
export const REFERRAL_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days

// Tier thresholds — each entry maps an invited-and-engaged count to the
// achievement key the inviter unlocks at that count. Capped at 25 to
// prevent farming (per product decision).
export const RECRUITER_TIERS: Array<{ min: number; key: string }> = [
  { min: 1,  key: 'recruiter_1' },
  { min: 5,  key: 'recruiter_5' },
  { min: 10, key: 'recruiter_10' },
  { min: 25, key: 'recruiter_25' },
]

// How recently a user must have been created for a referral cookie to be
// attributed. Guards against existing users clicking an invite link and
// being retroactively credited to someone they didn't actually sign up via.
const ATTRIBUTION_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Process a referral cookie for a just-authenticated user.
 *
 * Called from the auth callback. Returns the inviter's username if a
 * referral was recorded (so the caller can redirect to
 * `/onboarding?invited_by=<username>`), or `null` otherwise.
 *
 * Idempotent: the UNIQUE(invitee_id) constraint on `referrals` and the
 * existing-friendship check both no-op if called twice.
 */
export async function processReferralSignup(
  inviteeId: string,
  referralCode: string,
): Promise<string | null> {
  if (!referralCode) return null
  const admin = createAdminClient()

  // Only attribute for brand-new accounts — an established user who happens
  // to click an invite link should NOT get credited to someone new.
  const { data: invitee } = await admin
    .from('users')
    .select('id, username, created_at')
    .eq('id', inviteeId)
    .single()

  if (!invitee) return null
  const ageMs = Date.now() - new Date(invitee.created_at).getTime()
  if (ageMs > ATTRIBUTION_WINDOW_MS) return null

  // Resolve the referral code → inviter. Codes are usernames (case-insensitive).
  const { data: inviter } = await admin
    .from('users')
    .select('id, username')
    .ilike('username', referralCode)
    .maybeSingle()

  if (!inviter || inviter.id === inviteeId) return null

  // Record the referral. Unique(invitee_id) means re-runs silently no-op.
  const { error: referralErr } = await admin
    .from('referrals')
    .insert({ inviter_id: inviter.id, invitee_id: inviteeId })

  if (referralErr && referralErr.code !== '23505') {
    // 23505 = unique_violation — the invitee already has an inviter recorded
    console.error('[referrals] insert error:', referralErr.message)
    return null
  }

  // Auto-create an accepted friendship both directions (one row, since the
  // friendships table already covers both sides via requester/addressee).
  // Skip if a friendship already exists in either direction.
  const { data: existingFriendship } = await admin
    .from('friendships')
    .select('id, status')
    .or(
      `and(requester_id.eq.${inviter.id},addressee_id.eq.${inviteeId}),` +
      `and(requester_id.eq.${inviteeId},addressee_id.eq.${inviter.id})`,
    )
    .maybeSingle()

  if (!existingFriendship) {
    await admin.from('friendships').insert({
      requester_id: inviter.id,
      addressee_id: inviteeId,
      status:       'accepted',
    })
  } else if (existingFriendship.status !== 'accepted') {
    await admin
      .from('friendships')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', existingFriendship.id)
  }

  return inviter.username
}

/**
 * Invitee just submitted their first global (non-challenge) prediction.
 * Stamp `first_prediction_at`, then check whether the inviter just crossed
 * a Recruiter tier — if so, award the achievement + send the recruiter
 * notification about the invitee. Fire-and-forget; errors are logged.
 */
export async function markReferralFirstPrediction(
  admin: AdminClient,
  inviteeId: string,
): Promise<void> {
  try {
    // Only act on the FIRST prediction — if already stamped, nothing to do.
    const { data: referral } = await admin
      .from('referrals')
      .select('inviter_id, first_prediction_at')
      .eq('invitee_id', inviteeId)
      .maybeSingle()

    if (!referral || referral.first_prediction_at) return

    const { error: stampErr } = await admin
      .from('referrals')
      .update({ first_prediction_at: new Date().toISOString() })
      .eq('invitee_id', inviteeId)
      .is('first_prediction_at', null) // atomic guard against concurrent runs

    if (stampErr) {
      console.error('[referrals] stamp error:', stampErr.message)
      return
    }

    // Count this inviter's successful invites (first_prediction_at set).
    const { count } = await admin
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('inviter_id', referral.inviter_id)
      .not('first_prediction_at', 'is', null)

    const successfulInvites = count ?? 0

    // Award every tier the inviter now qualifies for. awardAchievement is
    // idempotent (UNIQUE + pre-check), so earlier tiers that were already
    // granted just no-op and return isNew=false.
    const awardResults = []
    for (const tier of RECRUITER_TIERS) {
      if (successfulInvites >= tier.min) {
        const res = await awardAchievement(admin, referral.inviter_id, tier.key)
        awardResults.push(res)
      }
    }
    if (awardResults.some(r => r.isNew)) {
      await notifyAchievements(admin, awardResults)
    }

    // Also fire a personalized "X joined via your invite" notification —
    // more engaging than an abstract achievement unlock.
    const { data: invitee } = await admin
      .from('users')
      .select('username')
      .eq('id', inviteeId)
      .single()

    if (invitee?.username) {
      await insertNotifications([{
        user_id: referral.inviter_id,
        type:    'referral_joined',
        meta:    { invitee_username: invitee.username },
      }])
    }
  } catch (err) {
    console.error('[referrals] markFirstPrediction error:', err)
  }
}

/**
 * Read helper for the /invite page. Returns the inviter's own counts.
 */
export async function getReferralStats(
  userId: string,
): Promise<{ total: number; activated: number }> {
  const admin = createAdminClient()

  const [{ count: total }, { count: activated }] = await Promise.all([
    admin
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('inviter_id', userId),
    admin
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('inviter_id', userId)
      .not('first_prediction_at', 'is', null),
  ])

  return { total: total ?? 0, activated: activated ?? 0 }
}
