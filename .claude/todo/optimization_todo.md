# Quiet Please — Technical Optimization Backlog

> Infrastructure, performance, and reliability improvements.
> Mark items ✅ as they ship. Add date completed.

---

## High Priority (Before Scale)

### Cron Job: Resilience & Idempotency
**File:** `src/app/api/cron/award-points/route.ts`
- Add alerting: ping a Slack webhook or send email if cron hasn't run in 25+ hours
- Consider splitting into two crons: `award-points` (frequent, match-by-match) and `recalculate-rankings` (nightly)

### Cron Job: Timeout Guard (future)
**File:** `src/app/api/cron/award-points/route.ts`
- The cron fetches all active predictions. At 10k users this could be 50k+ rows.
- Current: fetches in pages of 1000 — good. But no timeout guard.
- Add: hard stop at 10 minutes (Vercel Pro timeout), checkpoint resume via `cron_cursor` table
- `cron_runs` table now tracks duration_ms — use this to set baseline before adding guards

---

## Medium Priority

### Real-Time Layer (Supabase Realtime)
- "Opponent just submitted their picks" → live update without page refresh
- "Match result just came in" → bracket updates live
- Candidates: `ChallengeView.tsx`, tournament predict page
- Use `supabase.channel()` subscriptions on specific rows

### ISR Cache Invalidation
- Currently tournaments use `revalidate: 3600` (1 hour)
- On draw publish / result entry, admin triggers `revalidatePath()` — confirm this is wired up everywhere
- Add `revalidatePath` call in admin result-entry action

---

## Low Priority / Future (10k+ users)

### Move Cron to Queue-Based Processing
- Single serverless function with 60s timeout can't process 10K+ users
- Use a job queue (Bull, Inngest, or Vercel Cron + chunked processing)

### Add Redis Caching Layer
- Leaderboard, profile stats, and tournament data are read-heavy
- Cache with 30-60s TTL

### Database Connection Pooling
- Supabase Free allows 60 connections, Pro allows 200
- At peak, serverless functions could exhaust the pool
- Use pgBouncer pooler URL

### Move Ranking Recalculation to DB Trigger
- Currently runs as an RPC call per user in the cron
- A Postgres trigger on `point_ledger` INSERT could auto-recalculate

### Implement ISR/SSG for Public Pages
- Tournament list already cached (1h). Leaderboard now cached (5min).
- Expand ISR coverage to tournament detail and picks pages

### Analytics
- PostHog or Mixpanel integration
- Key funnels: signup → first prediction → first lock, challenge create → opponent submit rate
- Hold until product is more stable

### Bundle Size
- Audit `BracketPredictor.tsx` — large component with complex state
- Consider lazy-loading the predictor on predict pages (it's not above the fold)
- Check for duplicate Supabase client instances across server components
