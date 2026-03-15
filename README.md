# 🎾 Quiet Please

A tournament bracket prediction game for ATP & WTA tennis. Pick your winners before the draw closes, earn points based on real ATP/WTA scoring, and compete against friends in private leagues.

## What it does

- **Predict** — fill out the full bracket for any ATP or WTA tournament before it starts
- **Earn points** — scored using the real ATP/WTA point structure per round
- **Compete** — global leaderboard, private leagues, and head-to-head challenges
- **Follow the calendar** — automatically tracks all ATP & WTA tournaments year-round

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
