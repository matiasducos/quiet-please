'use server'

import { createClient } from '@/lib/supabase/server'

type PlayerSlot = {
  externalId: string
  name: string
  priority: number
}

type SurfaceConfig = {
  default: PlayerSlot[]
  hard: PlayerSlot[]
  clay: PlayerSlot[]
  grass: PlayerSlot[]
}

export type AutoPredictConfig = {
  enabled: boolean
  atp: SurfaceConfig
  wta: SurfaceConfig
}

/**
 * Fetch the user's full auto-predict configuration.
 */
export async function getAutoPredictConfig(): Promise<AutoPredictConfig> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { enabled: false, atp: emptySurfaceConfig(), wta: emptySurfaceConfig() }

  const [{ data: profile }, { data: rows }] = await Promise.all([
    supabase.from('users').select('auto_predict_enabled').eq('id', user.id).single(),
    supabase
      .from('auto_predict_players')
      .select('tour, surface, player_external_id, player_name, priority')
      .eq('user_id', user.id)
      .order('priority', { ascending: true }),
  ])

  const config: AutoPredictConfig = {
    enabled: profile?.auto_predict_enabled ?? false,
    atp: emptySurfaceConfig(),
    wta: emptySurfaceConfig(),
  }

  for (const row of rows ?? []) {
    const tour = row.tour.toLowerCase() as 'atp' | 'wta'
    const surface = (row.surface ?? 'default') as keyof SurfaceConfig
    config[tour][surface].push({
      externalId: row.player_external_id,
      name: row.player_name,
      priority: row.priority,
    })
  }

  return config
}

function emptySurfaceConfig(): SurfaceConfig {
  return { default: [], hard: [], clay: [], grass: [] }
}

/**
 * Search players by name (for the config UI).
 * Uses the user's session — players table has public read RLS.
 */
export async function searchPlayersForAutoPredict(
  query: string,
  tour: 'ATP' | 'WTA',
): Promise<{ players: Array<{ external_id: string; name: string; country: string }> }> {
  if (!query.trim()) return { players: [] }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { players: [] }

  const { data } = await supabase
    .from('players')
    .select('external_id, name, country')
    .eq('tour', tour)
    .ilike('name', `%${query}%`)
    .order('name')
    .limit(15)

  return { players: (data ?? []) as Array<{ external_id: string; name: string; country: string }> }
}

/**
 * Save an entire player list for a tour + surface combo.
 * Delete-then-insert approach: clears old rows, inserts new list.
 */
export async function saveAutoPredictList(
  tour: 'ATP' | 'WTA',
  surface: 'hard' | 'clay' | 'grass' | null,
  players: Array<{ externalId: string; name: string; priority: number }>,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  if (players.length > 5) return { ok: false, error: 'Maximum 5 players' }

  // Validate priorities are 1-5 and unique
  const priorities = new Set(players.map(p => p.priority))
  if (priorities.size !== players.length) return { ok: false, error: 'Duplicate priorities' }
  for (const p of players) {
    if (p.priority < 1 || p.priority > 5) return { ok: false, error: 'Priority must be 1-5' }
  }

  // Delete existing rows for this tour+surface
  let deleteQuery = supabase
    .from('auto_predict_players')
    .delete()
    .eq('user_id', user.id)
    .eq('tour', tour)

  if (surface === null) {
    deleteQuery = deleteQuery.is('surface', null)
  } else {
    deleteQuery = deleteQuery.eq('surface', surface)
  }

  const { error: delError } = await deleteQuery
  if (delError) return { ok: false, error: delError.message }

  // Insert new rows
  if (players.length > 0) {
    const rows = players.map(p => ({
      user_id:            user.id,
      tour,
      surface,
      player_external_id: p.externalId,
      player_name:        p.name,
      priority:           p.priority,
    }))

    const { error: insError } = await supabase
      .from('auto_predict_players')
      .insert(rows)
    if (insError) return { ok: false, error: insError.message }
  }

  return { ok: true }
}

/**
 * Remove a surface override (reverts user to using the default list for that surface).
 */
export async function removeAutoPredictOverride(
  tour: 'ATP' | 'WTA',
  surface: 'hard' | 'clay' | 'grass',
): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }

  await supabase
    .from('auto_predict_players')
    .delete()
    .eq('user_id', user.id)
    .eq('tour', tour)
    .eq('surface', surface)

  return { ok: true }
}
