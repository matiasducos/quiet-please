/**
 * Send notification + email when an achievement is newly earned.
 * Fire-and-forget — errors are logged but never thrown.
 */

import { insertNotifications } from '@/lib/notifications'
import { sendNotificationEmail, sendAchievementEarnedEmail } from '@/lib/email'
import { ACHIEVEMENTS } from './definitions'
import type { SupabaseClient } from '@supabase/supabase-js'

interface AwardResult {
  userId: string
  key: string
  isNew: boolean
}

/**
 * For each newly earned achievement, insert a notification and send an email.
 * Only processes results where isNew === true.
 */
export async function notifyAchievements(
  admin: SupabaseClient,
  results: AwardResult[],
): Promise<void> {
  const newAwards = results.filter(r => r.isNew)
  if (!newAwards.length) return

  try {
    // ── Fetch usernames for email CTA links ─────────────────────
    const userIds = [...new Set(newAwards.map(r => r.userId))]
    const { data: users } = await admin
      .from('users')
      .select('id, username')
      .in('id', userIds)

    const usernameMap: Record<string, string> = {}
    for (const u of users ?? []) {
      usernameMap[u.id] = u.username
    }

    // ── Insert notifications ────────────────────────────────────
    const notificationRows = newAwards.map(r => {
      const def = ACHIEVEMENTS[r.key]
      return {
        user_id: r.userId,
        type: 'achievement_earned' as const,
        meta: {
          achievement_key: r.key,
          achievement_name: def?.name ?? r.key,
          achievement_emoji: def?.emoji ?? '🏅',
          achievement_description: def?.description ?? '',
        },
      }
    })

    await insertNotifications(notificationRows)

    // ── Send emails (awaited to prevent Vercel runtime freeze) ──
    for (const r of newAwards) {
      const def = ACHIEVEMENTS[r.key]
      if (!def) continue
      const username = usernameMap[r.userId] ?? 'player'

      await sendNotificationEmail(
        r.userId,
        sendAchievementEarnedEmail,
        (email, unsubscribeToken) => ({
          to: email,
          achievementName: def.name,
          achievementEmoji: def.emoji,
          achievementDescription: def.description,
          username,
          unsubscribeToken,
        }),
      )
    }
  } catch (err) {
    console.error('[achievements] notify error:', err)
  }
}
