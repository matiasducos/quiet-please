# Architecture

## Overview

Quiet Please is a Next.js web app backed by Supabase. The system is split into four clear layers:

```
[ Client (Next.js) ]
        ↓
[ Next.js API routes ]
        ↓                          ↓
[ Supabase (DB/Auth) ]   [ Tennis data adapter ]
        ↓                          ↓
[ Background jobs ]      [ External tennis API ]
```

## Layers

### Client layer
Next.js App Router handles all UI. Server components fetch data directly from Supabase where possible. Client components handle interactive bracket picking, real-time leaderboard updates via Supabase Realtime.

### API routes
Next.js API routes handle:
- Prediction submission and validation
- League/challenge management
- Webhook endpoints for any future integrations

### Supabase
Handles everything backend:
- **PostgreSQL** — all app data (users, tournaments, predictions, points)
- **Auth** — email/password + OAuth (Google, etc.)
- **Realtime** — live leaderboard updates pushed to clients
- **Edge Functions** — background cron jobs (draw sync, result sync, points engine)
- **Storage** — user avatars

### Tennis data adapter
A dedicated abstraction layer in `src/lib/tennis/`. **Nothing in the app calls the external tennis API directly.** All calls go through the adapter, which:
1. Fetches from the configured provider
2. Transforms the response into our internal format
3. Returns normalised TypeScript types

This means swapping API providers (e.g. from api-tennis.com to Sportradar) only requires changes inside `src/lib/tennis/` — zero changes to the rest of the app.

See [api-adapter.md](api-adapter.md) for full details.

### Background jobs (Supabase Edge Functions cron)

| Job | Schedule | Purpose |
|---|---|---|
| `sync-draws` | Every 3 hours | Fetch new/updated tournament draws from the API |
| `sync-results` | Every 30 minutes | Fetch completed match results |
| `award-points` | Triggered after sync-results | Compare results against predictions, write to point_ledger |
| `lock-predictions` | At draw_close_at time | Mark all predictions as locked for a tournament |

## Hosting

- **Vercel** — Next.js frontend + API routes
- **Supabase cloud** — database, auth, realtime, storage, edge functions

## Key design decisions

### Why Next.js App Router?
- Server components allow direct DB reads without an extra API hop
- Great for SEO (tournament pages, player pages)
- Easy to scale with Vercel

### Why Supabase over plain PostgreSQL?
- Auth out of the box (crucial for user profiles, private leagues)
- Realtime subscriptions for live leaderboards
- Row Level Security (RLS) for data isolation between users/leagues
- Edge Functions for cron jobs — no extra infrastructure

### Why an adapter layer for tennis data?
Tennis data APIs vary in quality, cost, and coverage. Starting with a cheaper/free API and migrating to a premium one (Sportradar) later is a realistic growth path. The adapter makes this a one-day job instead of a full rewrite.

### Why store predictions as JSONB?
A full bracket for a 128-player Grand Slam has 127 matches across 7 rounds. Storing each pick as a separate row would require complex joins for every bracket view. JSONB stores the entire bracket as one document, making reads fast and simple while PostgreSQL still allows querying inside it.

### Why a separate point_ledger table?
- Full audit trail of every point award
- Easy to recalculate if there's a scoring dispute
- Powers analytics (which rounds do users predict best?)
- Essential for a future monetisation layer (paid leagues, prizes)
