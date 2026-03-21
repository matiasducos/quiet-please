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

- [ ] **Add rate limiting to server actions** — No rate limiting on `savePrediction`, `createChallenge`, `sendFriendRequest`. A bot could spam thousands of requests.
  - Solution: Upstash Redis rate limiter or simple in-memory token bucket
  - Files: `predict/actions.ts`, `challenges/new/actions.ts`, `friends/actions.ts`

- [x] **Paginate leaderboard predictions query** — ✅ Added `.limit(500)` to leaderboard predictions query.

- [ ] **Cron loads all predictions into memory** — For active tournaments, all predictions are fetched at once. With 10K users, that's 50MB+ in memory.
  - File: `src/app/api/cron/award-points/route.ts` (lines 52-59)
  - Fix: Process tournaments one at a time, paginate predictions

- [ ] **Race condition on challenge creation** — Check-then-insert pattern allows duplicates under concurrent requests. Add database unique constraint.
  ```sql
  CREATE UNIQUE INDEX idx_challenges_active_pair ON challenges
    (LEAST(challenger_id, challenged_id), GREATEST(challenger_id, challenged_id), tournament_id)
    WHERE status IN ('pending', 'accepted');
  ```

## 🟢 Medium — Fix before 2,000+ users

- [x] **Cache admin ID list** — ✅ Cached as module-level `Set` in `src/app/admin/actions.ts`.

- [ ] **Leaderboard rank COUNT query** — When user isn't in top 50, a COUNT query scans all users with more points. Consider approximate ranking or caching.
  - File: `src/app/leaderboard/page.tsx` (lines 84-94)

- [ ] **Multiple getUser() calls per request** — Almost every page calls `supabase.auth.getUser()` then queries the user profile. Could be cached in middleware.
  - Impact: ~2 DB roundtrips saved per page load

- [ ] **Email notifications sent synchronously in cron** — Award-points sends emails inline. Move to async queue.
  - File: `src/app/api/cron/award-points/route.ts`

## 🔵 Low — Fix before 10,000+ users

- [ ] **Move cron to queue-based processing** — Single serverless function with 60s timeout can't process 10K+ users. Use a job queue (Bull, Inngest, or Vercel Cron + chunked processing).

- [ ] **Add Redis caching layer** — Leaderboard, profile stats, and tournament data are read-heavy. Cache with 30-60s TTL.

- [ ] **Database connection pooling** — Supabase Free allows 60 connections, Pro allows 200. At peak, serverless functions could exhaust the pool. Use pgBouncer pooler URL.

- [ ] **Move ranking recalculation to DB trigger** — Currently runs as an RPC call per user. A Postgres trigger on `point_ledger` INSERT could auto-recalculate.

- [ ] **Implement ISR/SSG for public pages** — Tournament list, leaderboard could be statically generated with revalidation instead of server-rendered on every request.

---

## Supabase Plan Limits (for reference)

| Resource | Free | Pro ($25/mo) | Impact |
|----------|------|-------------|--------|
| DB connections | 60 | 200 | Bottleneck at ~500 concurrent users |
| DB size | 500MB | 8GB | Fine for 10K users |
| Auth users | Unlimited | Unlimited | No issue |
| Edge functions | 500K/mo | 2M/mo | Fine |
| Realtime connections | 200 | 500 | Not currently used |

---

## Quick Reference: Files Most Affected

| File | Issues | Priority |
|------|--------|----------|
| `src/app/api/cron/award-points/route.ts` | N+1 loops, memory, sequential processing | 🔴 Critical |
| `src/app/leaderboard/page.tsx` | Unbounded query, count query | 🟡 High |
| `src/app/tournaments/[id]/predict/actions.ts` | No rate limiting | 🟡 High |
| `src/app/challenges/new/actions.ts` | Race condition, no rate limiting | 🟡 High |
| `src/app/admin/actions.ts` | Admin cache, assertAdmin overhead | 🟢 Medium |
| `src/app/profile/[username]/page.tsx` | Multiple auth calls | 🟢 Medium |
