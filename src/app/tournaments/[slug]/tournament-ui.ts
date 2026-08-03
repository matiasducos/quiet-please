/**
 * Presentation constants shared by the hub and edition pages.
 *
 * Extracted from the old single tournament page, which is now split in two —
 * without this they would have been copy-pasted, and the tier colours are
 * already duplicated once in opengraph-image.tsx.
 */

import type { BracketData } from '@/lib/tournaments/series'

/**
 * The player shape BracketPredictor and TournamentMatchList render.
 *
 * They require a non-null name and country; the stored draw JSON does not
 * guarantee either, because a slot can be a qualifier placeholder that was
 * unnamed when the bracket was built. `toRenderDraw` is that boundary — the
 * alternative is casting the whole draw through `any`, which is how a null
 * name becomes a blank cell nobody notices.
 */
export type RenderPlayer = { externalId: string; name: string; country: string }

export type RenderMatch = {
  matchId: string
  round: string
  player1: RenderPlayer | null
  player2: RenderPlayer | null
  scheduledAt?: string
}

export type RenderDraw = {
  tournamentExternalId: string
  rounds: string[]
  matches: RenderMatch[]
}

function toRenderPlayer(player: {
  externalId: string
  name: string | null
  country: string | null
} | null): RenderPlayer | null {
  // A null slot is a bye and must stay null — the components detect byes by
  // exactly that, so substituting a placeholder here would break bracket
  // progression, not just the label.
  if (!player) return null
  return {
    externalId: player.externalId,
    name: player.name ?? 'Qualifier',
    country: player.country ?? '',
  }
}

export function toRenderDraw(bracket: BracketData | null): RenderDraw | null {
  if (!bracket?.matches?.length || !bracket.rounds?.length) return null
  return {
    tournamentExternalId: bracket.tournamentExternalId ?? '',
    rounds: bracket.rounds,
    matches: bracket.matches.map(match => ({
      matchId: match.matchId,
      round: match.round,
      player1: toRenderPlayer(match.player1),
      player2: toRenderPlayer(match.player2),
    })),
  }
}

export const TIER: Record<string, { label: string; bg: string; text: string }> = {
  'ATP|grand_slam':   { label: 'Grand Slam',   bg: '#1a1a2e', text: '#fff' },
  'ATP|masters_1000': { label: 'Masters 1000', bg: '#185FA5', text: '#fff' },
  'ATP|500':          { label: 'ATP 500',      bg: '#1e7a5e', text: '#fff' },
  'ATP|250':          { label: 'ATP 250',      bg: '#4a5568', text: '#fff' },
  'WTA|grand_slam':   { label: 'Grand Slam',   bg: '#1a1a2e', text: '#fff' },
  'WTA|masters_1000': { label: 'WTA 1000',     bg: '#7c2d7c', text: '#fff' },
  'WTA|500':          { label: 'WTA 500',      bg: '#993556', text: '#fff' },
  'WTA|250':          { label: 'WTA 250',      bg: '#4a5568', text: '#fff' },
}

export const SURFACE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  clay:  { bg: '#fdf2ed', text: '#993C1D', label: 'Clay' },
  grass: { bg: '#edf7f0', text: '#1a6b3c', label: 'Grass' },
  hard:  { bg: '#edf2fb', text: '#185FA5', label: 'Hard' },
}

export const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  upcoming:              { bg: '#f1efe8', text: '#5F5E5A', label: 'Upcoming' },
  draw_published:        { bg: '#edf2fb', text: '#185FA5', label: 'Draw published' },
  accepting_predictions: { bg: '#eaf3de', text: '#27500A', label: 'Predictions open' },
  in_progress:           { bg: '#faeeda', text: '#633806', label: 'In progress' },
  completed:             { bg: '#f1efe8', text: '#5F5E5A', label: 'Completed' },
}

export function formatDateRange(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt) return '—'
  const start = new Date(startsAt)
  const year = start.getFullYear()
  if (!endsAt || endsAt === startsAt) {
    return start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  }
  const end = new Date(endsAt)
  if (start.getMonth() === end.getMonth()) {
    const month = start.toLocaleDateString('en-GB', { month: 'long' })
    return `${start.getDate()} – ${end.getDate()} ${month}, ${year}`
  }
  const s = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const e = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${s} – ${e}, ${year}`
}

/**
 * Base points on offer per round, by tournament category. Mirrors the award
 * table the cron applies; shown so a visitor understands the scoring before
 * signing up.
 */
export function roundPoints(category: string): { round: string; ledger: string; pts: number }[] {
  const isSlam = category === 'grand_slam'
  const isMasters = category === 'masters_1000'
  const is500 = category === '500'

  const rows = [
    { round: 'Winner',       ledger: 'F',    pts: isSlam ? 2000 : isMasters ? 1000 : is500 ? 500 : 250 },
    { round: 'Semifinal',    ledger: 'SF',   pts: isSlam ? 720  : isMasters ? 360  : is500 ? 90  : 45 },
    { round: 'Quarterfinal', ledger: 'QF',   pts: isSlam ? 360  : isMasters ? 180  : is500 ? 60  : 29 },
    { round: 'R16',          ledger: 'R16',  pts: isSlam ? 180  : isMasters ? 90   : is500 ? 30  : 13 },
    { round: 'R32',          ledger: 'R32',  pts: isSlam ? 90   : isMasters ? 45   : is500 ? 20  : 6 },
  ]

  // Only the two largest categories play the early rounds.
  if (isSlam || isMasters) {
    rows.push({ round: 'R64',  ledger: 'R64',  pts: isSlam ? 45 : 25 })
    rows.push({ round: 'R128', ledger: 'R128', pts: 10 })
  }
  return rows
}
