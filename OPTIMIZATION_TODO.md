# Optimization Roadmap — Scaling Quiet Please

## Current State
The app works well for MVP with dozens of users. This roadmap identifies bottlenecks
that need fixing as the user base grows.

---

## 🔴 Critical — Fix before 100+ users

- [x] **Parallelize award-points cron** — ✅ Switched to `Promise.all` batches of 50 for all DB operations.

- [x] **Batch prediction updates in cron** — ✅ Prediction updates run in parallel batches of 50.

- [x] **Batch auto-lock updates in cron** — ✅ Auto-lock updates run in parallel batches of 50.

- [x] **Add composite index on point_ledger** — ✅ Added in migration 016 (`idx_point_ledger_match_prediction`).

## 🟡 High — Fix before 500+ users

- [x] **Add rate limiting to server actions** — ✅ In-memory sliding-window rate limiter (`src/lib/rate-limit.ts`). Applied to `savePrediction` (20/min), `createChallenge` (5/min), `sendFriendRequest` (10/min).

- [x] **Paginate leaderboard predictions query** — ✅ Added `.limit(500)` to leaderboard predictions query.

- [x] **Cron loads all predictions into memory** — ✅ Paginated per-tournament (1000/page). Indexed predictions by tournament_id for O(1) lookup. Batch challenge expiration into single UPDATE.

- [x] **Race condition on challenge creation** — ✅ Added unique partial index in migration 019 (`idx_challenges_active_pair`). Uses `LEAST/GREATEST` for direction-agnostic constraint.

## 🟢 Medium — Fix before 2,000+ users

- [x] **Cache admin ID list** — ✅ Cached as module-level `Set` in `src/app/admin/actions.ts`.

- [x] **Leaderboard rank COUNT query** — ✅ Changed `select('*')` to `select('id')` for lighter COUNT. Cached leaderboard data with `unstable_cache` (5 min TTL).

- [ ] **Multiple getUser() calls per request** — Almost every page calls `supabase.auth.getUser()` then queries the user profile. Could be cached in middleware.
  - Impact: ~2 DB roundtrips saved per page load

- [x] **Email notifications sent synchronously in cron** — ✅ Emails now fire-and-forget (not awaited before cron response).

## 🔵 Low — Fix before 10,000+ users

- [ ] **Move cron to queue-based processing** — Single serverless function with 60s timeout can't process 10K+ users. Use a job queue (Bull, Inngest, or Vercel Cron + chunked processing).

- [ ] **Add Redis caching layer** — Leaderboard, profile stats, and tournament data are read-heavy. Cache with 30-60s TTL.

- [ ] **Database connection pooling** — Supabase Free allows 60 connections, Pro allows 200. At peak, serverless functions could exhaust the pool. Use pgBouncer pooler URL.

- [ ] **Move ranking recalculation to DB trigger** — Currently runs as an RPC call per user. A Postgres trigger on `point_ledger` INSERT could auto-recalculate.

- [ ] **Implement ISR/SSG for public pages** — Tournament list already cached (1h). Leaderboard now cached (5min).

---

## Additional Optimizations Done

- [x] **Parallelize page queries** — ✅ All 7 main pages use `Promise.all` for concurrent DB fetches.
- [x] **Batch weekly slot checks** — ✅ `savePrediction` now checks all ISO weeks in a single `.or()` query instead of N separate queries.
- [x] **Parallelize challenge creation** — ✅ Friendship, tournament, and existing challenge checks run concurrently.
- [x] **Deferred font loading** — ✅ Display/mono fonts load without blocking paint.
- [x] **Dashboard consistency** — ✅ Fixed `total_points` → `ranking_points` inconsistency.

---

## Supabase Plan Limits (for reference)

| Resource | Free | Pro ($25/mo) | Impact |
|----------|------|-------------|--------|
| DB connections | 60 | 200 | Bottleneck at ~500 concurrent users |
| DB size | 500MB | 8GB | Fine for 10K users |
| Auth users | Unlimited | Unlimited | No issue |
| Edge functions | 500K/mo | 2M/mo | Fine |
| Realtime connections | 200 | 500 | Not currently used |
