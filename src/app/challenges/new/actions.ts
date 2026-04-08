'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { insertNotifications } from '@/lib/notifications'
import { sendNotificationEmail, sendChallengeReceivedEmail } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'
import { trackServerEvent } from '@/lib/posthog/server'
import { checkChallengeAchievements } from '@/lib/achievements/check'
import { notifyAchievements } from '@/lib/achievements/notify'

export async function createChallenge(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Rate limit: 5 challenge creations per minute per user
  const rl = rateLimit(`challenge:${user.id}`, { maxRequests: 5, windowMs: 60_000 })
  if (rl.limited) return { error: `Too many requests. Try again in ${rl.retryAfter}s.` }

  const friendId     = formData.get('friend_id') as string
  const tournamentId = formData.get('tournament_id') as string
  if (!friendId || !tournamentId) return { error: 'Missing required fields' }

  const admin = createAdminClient()

  // ── Parallel fetch: friendship + tournament + existing challenge ────────
  const [{ data: friendship }, { data: tournament }, { data: existing }] = await Promise.all([
    admin.from('friendships').select('id')
      .or(`and(requester_id.eq.${user.id},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${user.id})`)
      .eq('status', 'accepted')
      .maybeSingle(),
    admin.from('tournaments').select('id, status').eq('id', tournamentId).single(),
    admin.from('challenges').select('id')
      .eq('tournament_id', tournamentId)
      .in('status', ['pending', 'accepted'])
      .or(`and(challenger_id.eq.${user.id},challenged_id.eq.${friendId}),and(challenger_id.eq.${friendId},challenged_id.eq.${user.id})`)
      .maybeSingle(),
  ])

  if (!friendship) return { error: 'No accepted friendship with this user' }
  if (!tournament) return { error: 'Tournament not found' }
  if (tournament.status === 'completed') {
    return { error: 'Cannot create challenges for completed tournaments' }
  }
  if (existing) {
    return { error: 'An active challenge already exists with this friend for this tournament' }
  }

  const { error } = await admin
    .from('challenges')
    .insert({
      challenger_id: user.id,
      challenged_id: friendId,
      tournament_id: tournamentId,
    })

  if (error) return { error: error.message }

  // Notify the challenged user
  try {
    const [{ data: challengerProfile }, { data: tournamentForNotif }] = await Promise.all([
      admin.from('users').select('username').eq('id', user.id).single(),
      admin.from('tournaments').select('name, location, flag_emoji').eq('id', tournamentId).single(),
    ])
    await insertNotifications([{
      user_id:       friendId,
      type:          'challenge_received',
      tournament_id: tournamentId,
      meta: {
        challenger_username: challengerProfile?.username ?? 'Someone',
        tournament_name:     tournamentForNotif?.name    ?? 'a tournament',
        tournament_location: tournamentForNotif?.location ?? null,
        tournament_flag_emoji: tournamentForNotif?.flag_emoji ?? null,
      },
    }])
    // Await email — Vercel freezes runtime after redirect(), so fire-and-forget drops emails
    await sendNotificationEmail(friendId, sendChallengeReceivedEmail, (email, token) => ({
      to: email,
      challengerUsername: challengerProfile?.username ?? 'Someone',
      tournamentName: tournamentForNotif?.name ?? 'a tournament',
      unsubscribeToken: token,
    }))
  } catch (e) {
    console.error('[createChallenge] notification error', e)
  }

  trackServerEvent(user.id, 'challenge_created', { type: 'friend', tournament_id: tournamentId })

  // Achievement check (fire-and-forget)
  checkChallengeAchievements(admin, user.id)
    .then(results => notifyAchievements(admin, results))
    .catch(err => console.error('[createChallenge] achievement check error', err))

  redirect('/challenges')
}
