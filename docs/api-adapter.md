# Tennis data adapter

## Purpose

The adapter is a single abstraction layer between the app and any external tennis data API. **No other part of the codebase imports from a tennis API directly.**

Location: `src/lib/tennis/`

## Why this exists

Tennis data APIs vary in structure, pricing, and coverage. The project currently uses a free-tier API (via RapidAPI). Migrating to a premium provider (Sportradar) only requires changes inside `src/lib/tennis/providers/` — zero changes to any route, component, or cron job.

## File structure

```
src/lib/tennis/
├── index.ts               ← public interface — the only file the rest of the app imports
├── types.ts               ← internal normalised TypeScript types
├── points.ts              ← ATP/WTA points-per-round constants + helper
└── providers/
    ├── base.ts            ← abstract base class (TennisProvider)
    ├── api-tennis.ts      ← RapidAPI implementation (current)
    └── sportradar.ts      ← Sportradar stub (not yet implemented)
```

Note: there is no `transforms/` directory — response transformation is handled inside each provider implementation.

## Internal types (`types.ts`)

```ts
export type Tour = 'ATP' | 'WTA'
export type Surface = 'hard' | 'clay' | 'grass'
export type TournamentCategory = 'grand_slam' | 'masters_1000' | '500' | '250'
export type Round = 'R128' | 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'
export type TournamentStatus = 'upcoming' | 'accepting_predictions' | 'in_progress' | 'completed'

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
  player1: Player | null  // null = TBD (qualifier / bye)
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
  drawCloseAt: string  // ISO 8601
  startsAt: string
  endsAt: string
  status?: TournamentStatus
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

## Provider interface (`providers/base.ts`)

Every provider must implement:

```ts
export abstract class TennisProvider {
  abstract getTournaments(from: string, to: string): Promise<Tournament[]>
  abstract getUpcomingTournaments(): Promise<Tournament[]>
  abstract getDraw(tournamentExternalId: string): Promise<Draw>
  abstract getResults(tournamentExternalId: string): Promise<MatchResult[]>
}
```

## Public interface (`index.ts`)

Uses a factory function to pick the provider at startup:

```ts
import { ApiTennisProvider } from './providers/api-tennis'
import { SportradarProvider } from './providers/sportradar'

function createProvider(): TennisProvider {
  const apiKey = process.env.TENNIS_API_KEY!
  switch (process.env.TENNIS_API_PROVIDER ?? 'api-tennis') {
    case 'sportradar': return new SportradarProvider(apiKey)
    default:           return new ApiTennisProvider(apiKey)
  }
}

export const tennisAdapter = createProvider()
```

The rest of the app only ever does:

```ts
import { tennisAdapter } from '@/lib/tennis'

const draw = await tennisAdapter.getDraw(tournamentExternalId)
const results = await tennisAdapter.getResults(tournamentExternalId)
```

## Switching providers

1. Set `TENNIS_API_PROVIDER=sportradar` in environment variables
2. Implement `src/lib/tennis/providers/sportradar.ts` (stub already present)
3. Done — no other files change

## Current provider: api-tennis.com (via RapidAPI)

- **RapidAPI host**: `tennis-api-atp-wta-itf.p.rapidapi.com`
- **Auth**: `x-rapidapi-key` header (value = `TENNIS_API_KEY` env var)
- **Free tier**: ~200 requests/day
- **Endpoints used**:
  - `GET /tennis/v2/{atp|wta}/tournament/calendar/{year}` → season calendar
  - `GET /tennis/v2/{atp|wta}/fixtures/tournament/{id}` → draw + results for a specific tournament
- **roundId mapping**: `1=F`, `2=SF`, `3=QF`, `4=R16`, `5=R32`, `6=R64`, `7=R128`
- **rankId mapping** (category): `1=grand_slam`, `3=masters_1000`, `5=500`, `7=null (Tour Finals — skipped)`, else `250`
- **Known limitation**: calendar endpoint returns only the last ~11 events of the year (Nov–Dec). Spring/summer events (Mar–Oct) must be seeded manually via `/api/admin/seed-tournaments`.

## Future provider: Sportradar

- Official ATP/WTA data partner
- Full bracket data within hours of draw publication
- 30-day free trial; enterprise pricing thereafter
- Docs: https://developer.sportradar.com/tennis
- Migration: implement `sportradar.ts`, set env var — nothing else changes
