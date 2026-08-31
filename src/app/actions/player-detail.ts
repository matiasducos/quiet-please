'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface PlayerRoundDetail {
  round: string
  picks: number
  wins: number
  voided: number
  points: number
}

export interface PlayerTournamentDetail {
  tournament_id: string
  name: string
  location: string | null
  flag_emoji: string | null
  starts_at: string | null
  picks: number
  wins: number
  points: number
  exit_round: string | null
}

export interface PlayerDetail {
  ok: boolean
  rounds: PlayerRoundDetail[]
  tournaments: PlayerTournamentDetail[]
  /**
   * The other half of the record: matches this player contested that the user
   * passed on — backed the opponent, or left the slot blank — and how many of
   * those the player won anyway. Same definitions as the dashboard's "Ones that
   * got away" panel, from the same fixture-verified rules; see
   * 100_user_player_missed.sql.
   *
   * Both are 0 when the user has never met this player, which is indistinguishable
   * in the numbers from having met them and never been punished — so read
   * `missed` before drawing any conclusion from `missedWins`.
   */
  missed: number
  missedWins: number
  /**
   * Why `ok` is false. `/picks/[username]` is public once a bracket locks, so a
   * signed-out visitor can open the stats drawer — that is a missing session,
   * not a failure, and the two need different copy.
   */
  reason?: 'unauthenticated' | 'error'
}

/** Shared by the failure paths, so a new field cannot be forgotten in one of them. */
const EMPTY_DETAIL = { ok: false as const, rounds: [], tournaments: [], missed: 0, missedWins: 0 }

/**
 * How one user has fared backing one player — see 058_user_player_detail.sql.
 *
 * Goes through the admin client because those functions are granted to
 * service_role only. The profile Stats tab is visible to any signed-in viewer,
 * so this deliberately serves any profile's numbers, but it still requires a
 * session — the aggregate is not public.
 */
/** The signed-in viewer's own record for a player — used where there is no profile in context. */
export async function getMyPlayerDetail(externalId: string): Promise<PlayerDetail> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ...EMPTY_DETAIL, reason: 'unauthenticated' }
  return getPlayerDetail(user.id, externalId)
}

export async function getPlayerDetail(
  profileUserId: string,
  externalId: string,
): Promise<PlayerDetail> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ...EMPTY_DETAIL, reason: 'unauthenticated' }

  if (!profileUserId || !externalId) return { ...EMPTY_DETAIL, reason: 'error' }

  const admin = createAdminClient()
  const [roundsRes, tournamentsRes, missedRes] = await Promise.all([
    admin.rpc('user_player_round_detail', { p_user_id: profileUserId, p_external_id: externalId }),
    admin.rpc('user_player_tournament_detail', { p_user_id: profileUserId, p_external_id: externalId }),
    admin.rpc('user_player_missed', { p_user_id: profileUserId, p_external_id: externalId }),
  ])

  if (roundsRes.error) console.error('[profile] user_player_round_detail failed:', roundsRes.error.message)
  if (tournamentsRes.error) console.error('[profile] user_player_tournament_detail failed:', tournamentsRes.error.message)
  if (missedRes.error) console.error('[profile] user_player_missed failed:', missedRes.error.message)
  if (roundsRes.error || tournamentsRes.error) return { ...EMPTY_DETAIL, reason: 'error' }

  // A missed-winners failure is NOT fatal. The picks record is the substance of
  // this drawer and stands on its own; losing the counterpart to a missing
  // migration should degrade to hiding one line, not to an error screen for a
  // record that loaded fine. `missed: 0` is what the view reads as "nothing to
  // say", the same as a player never encountered.
  const missedRow = (missedRes.data ?? [])[0] as { missed: number; missed_wins: number } | undefined

  return {
    ok: true,
    rounds: (roundsRes.data ?? []) as PlayerRoundDetail[],
    tournaments: (tournamentsRes.data ?? []) as PlayerTournamentDetail[],
    missed: Number(missedRow?.missed ?? 0),
    missedWins: Number(missedRow?.missed_wins ?? 0),
  }
}
