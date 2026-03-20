'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { getPointsForRound } from '@/lib/tennis'
import { getTournamentISOWeeks } from '@/lib/utils/iso-week'
import { insertNotifications } from '@/lib/notifications'

export type SaveResult =
  | { success: true }
  | { success: false; error: 'slot_taken'; conflictingTournamentName: string }
  | { success: false; error: 'unknown'; message: string }

export async function savePrediction({
  tournamentId,
  picks,
  predictionId,
  lock = false,
  isPractice = false,
}: {
  tournamentId: string
  picks: Record<string, string>
  predictionId: string | null
  lock?: boolean
  isPractice?: boolean
}): Promise<SaveResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'unknown', message: 'Not authenticated' }

  // Practice mode: score immediately against existing match_results (all results
  // are already in the DB for completed tournaments — no cron needed).
  let pointsEarned = 0
  if (lock && isPractice) {
    const [{ data: tournament }, { data: matchResults }] = await Promise.all([
      supabase.from('tournaments').select('category').eq('id', tournamentId).single(),
      supabase.from('match_results').select('round, winner_external_id, score').eq('tournament_id', tournamentId),
    ])
    for (const result of matchResults ?? []) {
      // Skip BYE matches — auto-advances don't award points
      if ((result as any).score === 'BYE') continue
      if (Object.values(picks).includes(result.winner_external_id)) {
        const isWinner = result.round === 'F'
        pointsEarned += getPointsForRound(
          tournament!.category as any,
          result.round as any,
          isWinner,
        )
      }
    }
  }

  const row: Record<string, any> = {
    user_id:       user.id,
    tournament_id: tournamentId,
    picks,
    is_locked:     lock,
    is_practice:   isPractice,
    updated_at:    new Date().toISOString(),
  }
  if (lock && isPractice) row.points_earned = pointsEarned

  if (predictionId) {
    // ── UPDATE existing prediction ──────────────────────────────────────────
    const { error } = await supabase
      .from('predictions')
      .update(row)
      .eq('id', predictionId)
      .eq('user_id', user.id)
      .eq('is_locked', false)
    if (error) return { success: false, error: 'unknown', message: error.message }

  } else {
    // ── INSERT new prediction ───────────────────────────────────────────────
    // For real (non-practice) tournaments: enforce the one-slot-per-circuit-per-week rule.
    // Manual tournaments (created via admin for testing) are exempt from slot enforcement.
    if (!isPractice) {
      // Fetch tournament metadata needed for slot calculation
      const { data: tournament, error: tErr } = await supabase
        .from('tournaments')
        .select('tour, starts_at, ends_at, name, is_manual')
        .eq('id', tournamentId)
        .single()

      if (tErr || !tournament) {
        return { success: false, error: 'unknown', message: 'Tournament not found' }
      }

      // Skip slot enforcement for manual (admin-created) tournaments
      if (!tournament.is_manual) {
        const circuit = tournament.tour as 'ATP' | 'WTA'
        const weeks = getTournamentISOWeeks(tournament.starts_at, tournament.ends_at)

        // Check each ISO week: is there already a slot for this user + circuit
        // pointing to a DIFFERENT tournament?
        for (const w of weeks) {
          const { data: existing } = await supabase
            .from('weekly_slots')
            .select('tournament_id, tournaments(name)')
            .eq('user_id', user.id)
            .eq('circuit', circuit)
            .eq('iso_year', w.year)
            .eq('iso_week', w.week)
            .neq('tournament_id', tournamentId)
            .maybeSingle()

          if (existing) {
            const conflictingName = (existing.tournaments as any)?.name ?? 'another tournament'
            return { success: false, error: 'slot_taken', conflictingTournamentName: conflictingName }
          }
        }

        // No conflict — upsert slot rows (idempotent: same tournament re-saves are silently ignored)
        const slotRows = weeks.map(w => ({
          user_id:       user.id,
          circuit,
          iso_year:      w.year,
          iso_week:      w.week,
          tournament_id: tournamentId,
        }))
        const { error: slotError } = await supabase
          .from('weekly_slots')
          .upsert(slotRows, { onConflict: 'user_id,circuit,iso_year,iso_week', ignoreDuplicates: true })
        if (slotError) return { success: false, error: 'unknown', message: slotError.message }
      }
    }

    const { error } = await supabase
      .from('predictions')
      .insert({ ...row, submitted_at: new Date().toISOString() } as any)
    if (error) return { success: false, error: 'unknown', message: error.message }
  }

  revalidatePath(`/tournaments/${tournamentId}`)

  // When a real prediction is locked, notify all accepted friends
  if (lock && !isPractice) {
    try {
      const admin = createAdminClient()
      const [{ data: friendships }, { data: currentUserProfile }, { data: tournamentMeta }] = await Promise.all([
        admin
          .from('friendships')
          .select('requester_id, addressee_id')
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
          .eq('status', 'accepted'),
        admin.from('users').select('username').eq('id', user.id).single(),
        admin.from('tournaments').select('name').eq('id', tournamentId).single(),
      ])
      if (friendships && friendships.length > 0 && currentUserProfile && tournamentMeta) {
        const friendIds = friendships.map(f =>
          f.requester_id === user.id ? f.addressee_id : f.requester_id
        )
        await insertNotifications(
          friendIds.map(friendId => ({
            user_id:       friendId,
            type:          'friend_picks_locked',
            tournament_id: tournamentId,
            meta: {
              username:        currentUserProfile.username,
              tournament_name: tournamentMeta.name,
            },
          }))
        )
      }
    } catch (e) {
      console.error('[savePrediction] friend_picks_locked notification error', e)
    }
  }

  return { success: true }
}
