import type { SupabaseClient } from '@supabase/supabase-js'

type DrawSlot = { externalId?: string | null } | null | undefined

/**
 * Names for picked players the draw no longer contains.
 *
 * A pick stores a player id, and the draw is a snapshot rather than a foreign
 * key: a withdrawal replaced after predictions opened (Musetti → Faria at Tokyo
 * 2026) leaves the pick pointing at someone the draw cannot name. The bracket
 * then has nothing to say about who the user picked. The player registry still
 * knows, so look them up there.
 *
 * Bounded by one bracket's own picks (≤127 ids, in practice none to two), so a
 * single `.in()` is safe — it never approaches the URL limit.
 */
export async function loadStrayPickPlayers(
  supabase: SupabaseClient,
  picks: Record<string, string>,
  matches: { player1?: DrawSlot; player2?: DrawSlot }[],
): Promise<Record<string, { name: string; country: string }>> {
  const idsInDraw = new Set(
    matches.flatMap(m => [m.player1?.externalId, m.player2?.externalId]).filter(Boolean) as string[],
  )
  const missingIds = [...new Set(Object.values(picks).filter(id => id && !idsInDraw.has(id)))]
  if (missingIds.length === 0) return {}

  const { data, error } = await supabase
    .from('players')
    .select('external_id, name, country')
    .in('external_id', missingIds)
  if (error) {
    console.error('[stray-picks] player lookup failed:', error.message)
    return {}
  }
  return Object.fromEntries(data.map(p => [p.external_id, { name: p.name, country: p.country }]))
}
