# Roadmap

## Phase 1 — Foundation ✅ (complete)
- ✅ Project scaffold (Next.js + Supabase)
- ✅ Database schema + migrations
- ✅ Tennis data adapter (base + api-tennis.com provider via RapidAPI)
- ✅ Supabase Auth (email + Google OAuth)
- ✅ User profile page

## Phase 2 — Core prediction game ✅ (complete)
- ✅ Tournament list page (ATP + WTA calendar, surface filters)
- ✅ Bracket viewer (read-only draw display)
- ✅ Bracket prediction UI (pick winners round by round)
- ✅ Prediction lock at draw_close_at
- ✅ Cron: sync draws from API
- ✅ Cron: sync match results
- ✅ Points engine (compare picks vs results, write points_earned)
- ✅ Global leaderboard

## Phase 3 — Social & leagues ✅ (complete)
- ✅ Private leagues (create, invite via code, per-league leaderboard)
- ✅ League activity feed (join / locked picks / points events)
- ✅ Head-to-head challenges (tournament-scoped, accept/decline, result)
- ✅ Friends system (search, send/accept/decline requests)
- ✅ User stats page (hit rate, prediction history, challenges)

## Phase 4 — Polish & growth ✅ (complete)
- ✅ Color-coded bracket picks (green = correct, red = wrong, gold = champion)
- ✅ Tournament card filtering (ATP/WTA + surface)
- ✅ Email notifications (draw opens + points awarded)
- ✅ In-app notification dot in Nav
- ✅ ISR-cached public tournament pages (1 hour)
- ✅ Open Graph images (1200×630, tier + surface badges)
- ✅ /tournaments accessible without login
- ✅ Share bracket link (copy public URL to clipboard)
- ✅ Public per-user picks view (/tournaments/[id]/picks/[username])
- ✅ All-picks leaderboard per tournament (/tournaments/[id]/picks)
- ✅ Admin panel (trigger all cron jobs from browser)
- ✅ Sticky bracket header (nav + banner + round tabs)
- ✅ Practice mode (completed tournaments, picks scored immediately, no ranking_points)

## Phase 5 — Mobile + UX + Infrastructure ✅ (complete as of Session 17)
- ✅ Mobile responsive Nav (admin/sign-out pill hidden on mobile, sign-out in tab row)
- ✅ Mobile responsive BracketPredictor (banners reflow, save draft hidden in sticky nav)
- ✅ Tournament list grouped by month (collapsed by default, expand on click)
- ✅ City dropdown on profile location form (country-driven, 47 countries)
- ✅ Points removed from Nav (visible on leaderboard + profile instead)
- ✅ Applied pending DB migrations (003, 004, 007) to production Supabase
- ✅ Re-enabled email confirmation in Supabase Auth settings
- ✅ Tournament status override in admin panel (force in_progress/completed without sync)
- ✅ Loading skeletons for all data-heavy pages (Suspense boundaries via loading.tsx)
- ✅ Vercel Analytics (`@vercel/analytics`) added to root layout

## Phase 6 — Challenge a friend ✅ (complete)
- ✅ Friendship/follow system (search by username, send/accept/decline)
- ✅ Challenge hub (/challenges — pending/active/past grouped by state)
- ✅ New challenge flow (/challenges/new — 2-step: friend → tournament)
- ✅ Challenge detail (/challenges/[id] — accept/decline, lock status, result banner)
- ✅ Challenge history on profile page (WIN/LOSS/DRAW table)
- ✅ Award-points cron expires pending challenges + scores completed ones

## Phase 7 — ATP-style ranking system ✅ (complete)
- ✅ Rolling 52-week window (points expire 364 days after tournament)
- ✅ Weekly slot enforcement (one ATP + one WTA slot per ISO week per user)
- ✅ Grand Slams consume both ISO weeks they span
- ✅ Circuit breakdown (ATP / WTA / combined) on profile and leaderboard
- ✅ Leaderboard scopes: Worldwide / Country / City
- ✅ Country + city on user profile (inline edit form)
- ✅ recalculate_ranking_points() SQL function

---

## Current priorities (as of March 2026 — Session 17)

### High priority
- **Complete tournament calendar** — seed file missing all 250-level events + past Jan–March 2026 tournaments (Australian Open etc.). Fix: expand `src/app/api/admin/seed-tournaments/route.ts` then hit `/api/admin/seed-tournaments` + run sync-backfill

### Medium priority
- **Upgrade cron schedules** — Vercel Pro ($20/mo) for sub-hourly syncs during live tournaments (results every 30 min, award-points every 35 min)

### ✅ Recently completed (Session 17)
- ✅ Apply pending migrations to prod (003, 004, 007)
- ✅ Re-enable email confirmation
- ✅ Tournament status override in admin panel
- ✅ Loading skeletons for all data-heavy pages
- ✅ Vercel Analytics

### Lower priority / nice to have
- All-time points view alongside 52-week ranking
- Player search / bracket search
- League-level ranking (per-league rolling points)
- Invite link for non-users → /challenges/invite/[token]
- In-app + email notifications for challenge lifecycle events

---

## Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2025-03 | Supabase over plain PostgreSQL | Auth + Realtime built in, generous free tier |
| 2025-03 | api-tennis.com (via RapidAPI) as starting provider | Free tier available, easy to swap via adapter |
| 2025-03 | JSONB for bracket picks | Avoids complex joins, fast reads, easy to evolve |
| 2025-03 | point_ledger as append-only table | Audit trail, analytics, dispute resolution |
| 2025-03 | Next.js App Router | Server components + SEO + Vercel native support |
| 2025-09 | Vercel Cron over Supabase Edge Functions | Simpler to manage alongside the Next.js codebase |
| 2025-10 | Server Actions for mutations | No extra API routes, clean cache invalidation with revalidatePath |
| 2025-12 | Admin client (service role) for cross-user reads | Auth session doesn't propagate correctly for league/challenge joins |
| 2026-01 | Rolling 52-week ranking_points over total_points | Matches ATP model, rewards recency, enables geographic leaderboards |
| 2026-01 | DB-level UNIQUE constraint for weekly_slots | Concurrent request safety, bypass-proof enforcement |
