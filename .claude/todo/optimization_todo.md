# Quiet Please — Technical Optimization Backlog

> Infrastructure, performance, and reliability improvements.
> Mark items ✅ as they ship. Add date completed.

---

## High Priority (Before Scale)

### Cron Job: Resilience & Idempotency
**File:** `src/app/api/cron/award-points/route.ts`
- Add idempotency: check if `point_ledger` row already exists before inserting (prevent double-awards on retry)
- Add retry logic: Vercel cron failures are silent — add a `cron_runs` log table to track last success
- Add alerting: ping a Slack webhook or send email if cron hasn't run in 25+ hours
- Circuit breaker: if processing >500 predictions in a single run, log warning + continue (not abort)
- Consider splitting into two crons: `award-points` (frequent, match-by-match) and `recalculate-rankings` (nightly)

### Cron Job: Circuit Breaker / Pagination Guard
**File:** `src/app/api/cron/award-points/route.ts`
- The cron fetches all active predictions. At 10k users this could be 50k+ rows.
- Current: fetches in pages of 1000 — good. But no timeout guard.
- Add: hard stop at 10 minutes (Vercel Pro timeout), checkpoint resume via `cron_cursor` table
- Add: per-run metrics logged to Supabase (`cron_metrics` table: run_at, predictions_scored, duration_ms, errors)

---

## Medium Priority

### Multiple getUser() Calls Per Request
- Almost every page calls `supabase.auth.getUser()` then queries the user profile separately
- Impact: ~2 DB roundtrips saved per page load
- Fix: cache auth + profile in middleware or a shared server utility

### Real-Time Layer (Supabase Realtime)
- "Opponent just submitted their picks" → live update without page refresh
- "Match result just came in" → bracket updates live
- Candidates: `ChallengeView.tsx`, tournament predict page
- Use `supabase.channel()` subscriptions on specific rows

### ISR Cache Invalidation
- Currently tournaments use `revalidate: 3600` (1 hour)
- On draw publish / result entry, admin triggers `revalidatePath()` — confirm this is wired up everywhere
- Add `revalidatePath` call in admin result-entry action

### DB Index Audit
- Confirm indexes exist on: `predictions.user_id`, `predictions.tournament_id`, `predictions.challenge_id`
- `point_ledger.prediction_id`, `point_ledger.match_result_id`
- `challenges.share_code` (already in migration 027)
- `notifications.user_id + read_at` for unread count query

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

---

## Completed ✅

- ✅ Parallelize award-points cron — switched to `Promise.all` batches of 50
- ✅ Batch prediction + auto-lock updates in cron — parallel batches of 50
- ✅ Composite index on point_ledger — migration 016 (`idx_point_ledger_match_prediction`)
- ✅ Rate limiting on server actions — in-memory sliding-window, applied to savePrediction / createChallenge / sendFriendRequest
- ✅ Paginate leaderboard predictions query — added `.limit(500)`
- ✅ Cron pagination — paginated per-tournament (1000/page), O(1) lookup by tournament_id
- ✅ Race condition on challenge creation — unique partial index in migration 019
- ✅ Cache admin ID list — module-level `Set` in `src/app/admin/actions.ts`
- ✅ Leaderboard rank COUNT query — `select('id')` instead of `select('*')`, cached with `unstable_cache` (5 min TTL)
- ✅ Email notifications fire-and-forget in cron
- ✅ Parallelize page queries — all main pages use `Promise.all`
- ✅ Batch weekly slot checks — single `.or()` query
- ✅ Fix `unstable_cache` keys — include filter params in key arrays
- ✅ Country flags on leaderboard
- ✅ Location prominence swap — city/country as primary heading across entire app
