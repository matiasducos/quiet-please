'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface PlayerRoundDetail {
  round: string
  picks: number
  wins: number
  dead: number
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
}

/**
 * How one user has fared backing one player — see 058_user_player_detail.sql.
 *
 * Goes through the admin client because those functions are granted to
 * service_role only. The profile Stats tab is visible to any signed-in viewer,
 * so this deliberately serves any profile's numbers, but it still requires a
 * session — the aggregate is not public.
 */
export async function getPlayerDetail(
  profileUserId: string,
  externalId: string,
): Promise<PlayerDetail> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, rounds: [], tournaments: [] }

  if (!profileUserId || !externalId) return { ok: false, rounds: [], tournaments: [] }

  const admin = createAdminClient()
  const [roundsRes, tournamentsRes] = await Promise.all([
    admin.rpc('user_player_round_detail', { p_user_id: profileUserId, p_external_id: externalId }),
    admin.rpc('user_player_tournament_detail', { p_user_id: profileUserId, p_external_id: externalId }),
  ])

  if (roundsRes.error) console.error('[profile] user_player_round_detail failed:', roundsRes.error.message)
  if (tournamentsRes.error) console.error('[profile] user_player_tournament_detail failed:', tournamentsRes.error.message)
  if (roundsRes.error || tournamentsRes.error) return { ok: false, rounds: [], tournaments: [] }

  return {
    ok: true,
    rounds: (roundsRes.data ?? []) as PlayerRoundDetail[],
    tournaments: (tournamentsRes.data ?? []) as PlayerTournamentDetail[],
  }
}
