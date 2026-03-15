# Tennis data adapter

## Purpose

The adapter is a single abstraction layer that sits between the app and any external tennis data API. **No other part of the codebase imports from an external tennis API directly.**

Location: `src/lib/tennis/`

## Why this exists

Tennis data APIs vary significantly in structure, pricing, and coverage. This project may start on a free/cheap tier (api-tennis.com) and migrate to a premium provider (Sportradar) as it scales. The adapter ensures that migration only touches files inside `src/lib/tennis/` — zero changes elsewhere.

## Structure

```
src/lib/tennis/
├── index.ts          ← public interface — the only file the rest of the app imports
├── types.ts          ← internal normalised TypeScript types
├── points.ts         ← ATP/WTA points-per-round constants
├── providers/
│   ├── base.ts       ← abstract base class all providers implement
│   ├── api-tennis.ts ← api-tennis.com implementation
│   └── sportradar.ts ← Sportradar implementation (future)
└── transforms/
    ├── draw.ts       ← transforms raw API bracket → internal Draw type
    ├── result.ts     ← transforms raw API result → internal MatchResult type
    └── tournament.ts ← transforms raw API tournament → internal Tournament type
```

## Internal types (types.ts)

```ts
export type Tour = 'ATP' | 'WTA'
export type Surface = 'hard' | 'clay' | 'grass'
export type TournamentCategory = 'grand_slam' | 'masters_1000' | '500' | '250'
export type Round = 'R128' | 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'

export interface Player {
  externalId: string
  name: string
  country: string
  ranking?: number
  seed?: number
}

export interface DrawMatch {
  matchId: string
  round: Round
  player1: Player | null   // null = TBD (qualifier / bye)
  player2: Player | null
  scheduledAt?: string
}

export interface Draw {
  tournamentExternalId: string
  rounds: Round[]
  matches: DrawMatch[]
}

export interface Tournament {
  externalId: string
  name: string
  tour: Tour
  category: TournamentCategory
  surface: Surface
  drawCloseAt: string      // ISO 8601
  startsAt: string
  endsAt: string
}

export interface MatchResult {
  externalMatchId: string
  tournamentExternalId: string
  round: Round
  winnerExternalId: string
  loserExternalId: string
  score: string
  playedAt: string
}
```

## Provider interface (providers/base.ts)

Every provider must implement these four methods:

```ts
export abstract class TennisProvider {
  abstract getTournaments(from: string, to: string): Promise<Tournament[]>
  abstract getDraw(tournamentExternalId: string): Promise<Draw>
  abstract getResults(tournamentExternalId: string): Promise<MatchResult[]>
  abstract getUpcomingTournaments(): Promise<Tournament[]>
}
```

## Public interface (index.ts)

```ts
import { ApitennisProvider } from './providers/api-tennis'
import { SportradarProvider } from './providers/sportradar'

const provider = process.env.TENNIS_API_PROVIDER === 'sportradar'
  ? new SportradarProvider(process.env.TENNIS_API_KEY!)
  : new ApitennisProvider(process.env.TENNIS_API_KEY!)

export const tennisAdapter = provider
```

The rest of the app only ever does:

```ts
import { tennisAdapter } from '@/lib/tennis'

const draw = await tennisAdapter.getDraw(tournamentExternalId)
```

## Switching providers

1. Set `TENNIS_API_PROVIDER=sportradar` in environment variables
2. Implement `src/lib/tennis/providers/sportradar.ts` (stub already present)
3. Done — no other files change

## Current provider: api-tennis.com

- Free tier: 200 requests/day
- Paid tiers from ~$10/month
- Covers ATP + WTA draws, results, rankings
- RapidAPI: https://rapidapi.com/jjrm365-kIFr3Nx_odV/api/tennis-api-atp-wta-itf

## Future provider: Sportradar

- 30-day free trial (no credit card)
- 100% official ATP coverage as of 2025
- Full bracket data within 3 hours of draw publication
- Enterprise pricing (negotiated)
- Docs: https://developer.sportradar.com/tennis
