import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../../auth'
import { redirect } from 'next/navigation'
import DrawBuilder from './DrawBuilder'

export default async function DrawPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params

  const admin = createAdminClient()

  // Load tournament info and existing draw in parallel
  const [{ data: tournament }, { data: draw }] = await Promise.all([
    admin
      .from('tournaments')
      .select('id, name, draw_size, tour')
      .eq('id', id)
      .single(),
    admin
      .from('draws')
      .select('bracket_data')
      .eq('tournament_id', id)
      .single(),
  ])

  if (!tournament) redirect('/admin')

  // Extract first-round matches from existing bracket_data (if any)
  // bracket_data shape: { rounds: string[], matches: [{ matchId, round, player1, player2 }] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bracketData = draw?.bracket_data as any
  let existingSlots: Array<{
    player1: { external_id: string; name: string; country: string } | 'BYE' | null
    player2: { external_id: string; name: string; country: string } | 'BYE' | null
  }> | undefined

  if (bracketData?.matches && bracketData.rounds?.length > 0) {
    const firstRound = bracketData.rounds[0]
    const firstRoundMatches = bracketData.matches.filter(
      (m: any) => m.round === firstRound,
    )

    existingSlots = firstRoundMatches.map((m: any) => ({
      player1: m.player1
        ? { external_id: m.player1.externalId, name: m.player1.name, country: m.player1.country }
        : m.player2 && !m.player1
          ? 'BYE'  // player2 exists but player1 is null → player1 side is a BYE
          : null,
      player2: m.player2
        ? { external_id: m.player2.externalId, name: m.player2.name, country: m.player2.country }
        : m.player1 && !m.player2
          ? 'BYE'  // player1 exists but player2 is null → player2 side is a BYE
          : null,
    }))
  }

  return (
    <DrawBuilder
      tournamentId={tournament.id}
      tournamentName={tournament.name}
      tournamentLocation={tournament.location ?? null}
      flagEmoji={tournament.flag_emoji ?? null}
      drawSize={tournament.draw_size ?? 32}
      tour={tournament.tour as 'ATP' | 'WTA'}
      existingSlots={existingSlots}
    />
  )
}
