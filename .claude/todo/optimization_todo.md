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

## Low Priority / Future

### Analytics
- PostHog or Mixpanel integration
- Key funnels to track:
  - Signup → first prediction → first lock
  - Challenge create → opponent submit rate
  - Weekly slot blocker fire rate (how often are users blocked?)
- Hold until product is more stable

### Bundle Size
- Audit BracketPredictor.tsx — large component with complex state
- Consider lazy-loading the predictor on predict pages (it's not above the fold)
- Check for duplicate Supabase client instances across server components

---

## Completed ✅

*(none yet)*
