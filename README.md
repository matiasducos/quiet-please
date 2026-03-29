# 🎾 Quiet Please

A tournament bracket prediction game for ATP & WTA tennis. Pick your winners before the draw closes, earn points based on real ATP/WTA scoring, and compete against friends in private leagues.

## What it does

- **Predict** — fill out the full bracket for any ATP or WTA tournament before it starts
- **Earn points** — scored using the real ATP/WTA point structure per round
- **Compete** — global leaderboard, private leagues, and head-to-head challenges
- **Follow the calendar** — automatically tracks all ATP & WTA tournaments year-round

## How predictions work — three modes

The app has three distinct prediction modes with different rules, storage, and scoring behaviour.

### 1. 🌍 Global Tournament Prediction
The main game. Authenticated users pick a full bracket for a tournament. One prediction per ATP/WTA slot per ISO calendar week.

- **When open:** Controlled by the admin prediction mode toggle (`anytime` = open during `accepting_predictions` + `in_progress`; `pre_tournament` = only before the first match starts)
- **Scoring:** Base points per round × streak multiplier (consecutive correct picks on the same player compound). Processed by the `award-points` cron as match results arrive.
- **Affects:** Global leaderboard ✅ · Private leagues ✅ · `points_awarded` notification + email ✅
- **Route:** `/tournaments/[id]/predict` (no `?challenge=` param)

### 2. ⚔️ Friends Challenge
Two authenticated friends each make a separate bracket for the same tournament and compete head-to-head. Picks are completely independent of their global predictions.

- **When open:** **Always** open for `accepting_predictions` + `in_progress` — the admin prediction mode toggle does **not** apply to challenges.
- **One challenge per pair per tournament** — duplicate attempts are blocked.
- **Poker rule:** opponent's score is hidden until both players lock their bracket.
- **Scoring:** Same algorithm as global predictions, but points stay within the challenge — they do **not** affect the leaderboard, leagues, or rankings.
- **Finalized by cron** when tournament completes: higher `points_earned` wins; tiebreaker = more picks made; still tied = draw.
- **Routes:** Create at `/challenges/new`; make picks at `/tournaments/[id]/predict?challenge=[id]`

### 3. 👻 Anonymous Challenge
A shareable 1v1 bracket challenge — no account required. Anyone can create one and send a link.

- **When open:** Always open for `accepting_predictions` + `in_progress`. Toggle does not apply.
- **No auth:** Identity is a display name + a token stored in `localStorage`.
- **Storage:** Picks stored as JSONB directly on the `challenges` row (`creator_picks` / `opponent_picks`) — not in the `predictions` table.
- **Scoring:** Same points algorithm, scored by the cron against the JSONB picks. Does **not** affect leaderboard, leagues, or rankings.
- **Rate limited:** 3 challenge creations/hour per IP, 10 opponent submissions/hour per IP.
- **Routes:** Create at `/challenges/create`; play at `/c/[shareCode]`

### Summary

| | Global | Friends Challenge | Anonymous |
|---|---|---|---|
| Auth required | ✅ | ✅ | ❌ |
| Prediction window | Toggle-controlled | Always in_progress + accepting | Always in_progress + accepting |
| Max per tournament | 1 per tour/week slot | 1 per pair | Unlimited |
| Affects leaderboard | ✅ | ❌ | ❌ |
| Affects leagues | ✅ | ❌ | ❌ |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend + API routes | Next.js (App Router) |
| Database + Auth + Realtime | Supabase (PostgreSQL) |
| Tennis data | Abstraction layer (api-tennis.com / Sportradar) |
| Hosting | Vercel |
| Background jobs | Supabase Edge Functions (cron) |

## Docs

- [Architecture](docs/architecture.md)
- [Database schema](docs/database.md)
- [Tennis data adapter](docs/api-adapter.md)
- [Roadmap](docs/roadmap.md)

## Getting started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A tennis data API key (see [api-adapter docs](docs/api-adapter.md))

### Local setup

```bash
git clone https://github.com/matiasducos/quiet-please.git
cd quiet-please
npm install
cp .env.example .env.local
# fill in your env vars
npm run dev
```

### Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
TENNIS_API_KEY=
TENNIS_API_PROVIDER=api-tennis  # or: sportradar
```

### Database setup

```bash
# Apply migrations via Supabase CLI
supabase db push
```

## Project structure

```
/
├── docs/                   # Architecture, schema, adapter, roadmap
├── src/
│   ├── app/                # Next.js App Router pages
│   ├── components/         # UI components
│   ├── lib/
│   │   ├── supabase/       # Supabase client helpers
│   │   └── tennis/         # Tennis data adapter
│   └── types/              # TypeScript types
└── supabase/
    └── migrations/         # SQL migration files
```

## Contributing

This is a private project. See [roadmap](docs/roadmap.md) for planned work.
