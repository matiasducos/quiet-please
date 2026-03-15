# Roadmap

## Phase 1 — Foundation (current)
- [ ] Project scaffold (Next.js + Supabase)
- [ ] Database schema + migrations
- [ ] Tennis data adapter (base + api-tennis.com provider)
- [ ] Supabase Auth (email + Google OAuth)
- [ ] User profile page

## Phase 2 — Core prediction game
- [ ] Tournament list page (ATP + WTA calendar)
- [ ] Bracket viewer (read-only draw display)
- [ ] Bracket prediction UI (pick winners round by round)
- [ ] Prediction lock at draw_close_at
- [ ] Cron: sync draws from API
- [ ] Cron: sync match results
- [ ] Points engine (compare picks vs results, write to point_ledger)
- [ ] Global leaderboard

## Phase 3 — Social & leagues
- [ ] Private leagues (create, invite via code)
- [ ] League leaderboard
- [ ] Head-to-head challenges (tournament-scoped)
- [ ] Season-long group challenges
- [ ] User stats page (pick accuracy, best tournaments, etc.)

## Phase 4 — Polish & growth
- [ ] Push notifications (match result alerts, points awarded)
- [ ] Mobile-optimised bracket UI
- [ ] Sportradar API migration (if scale requires it)
- [ ] i18n foundation (Spanish, French, German)
- [ ] SEO: tournament pages, player pages

## Phase 5 — Monetisation
- [ ] Premium leagues (paid entry, prize pools)
- [ ] Sponsored tournaments
- [ ] Pro tier (advanced stats, prediction history export)

## Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2025-03 | Supabase over plain PostgreSQL | Auth + Realtime built in, generous free tier |
| 2025-03 | api-tennis.com as starting provider | Free tier available, easy to swap via adapter |
| 2025-03 | JSONB for bracket picks | Avoids complex joins, fast reads, easy to evolve |
| 2025-03 | point_ledger as append-only table | Audit trail, analytics, dispute resolution |
| 2025-03 | Next.js App Router | Server components + SEO + Vercel native support |
