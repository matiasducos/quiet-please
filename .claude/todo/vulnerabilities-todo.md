# Security & vulnerabilities — tracking

Actionable follow-ups from a codebase review (March 2026). Check items off as you address them.

---

## Pre-launch checklist (paid ads / public traffic)

- [ ] **Upgrade Next.js** past 16.1.6 — `npm audit` reports moderate advisories (Server Actions / dev HMR CSRF with `null` origin, `next/image` cache growth, postponed resume buffering DoS, rewrite request smuggling). Target a patched 16.2.x+ after testing.
- [x] **Harden OAuth callback redirect** ✅ 2026-03-25 — `getSafeRedirectPath()` validates `next` param: must start with `/`, rejects `//`, rejects protocol schemes and backslash tricks.
- [x] **Production surface: `/test-tournaments`** ✅ 2026-03-25 — Gated with `requireAdmin()` on page + `requireAdminAction()` on server actions.
- [ ] **Supabase Security Advisor** — Run in dashboard; fix RLS / policy warnings before scaling traffic.
- [ ] **Secrets hygiene** — Confirm `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_USER_IDS` are set in prod; never commit real values. Audit tracked docs for accidental env leaks.
- [ ] **Billing / abuse alerts** — Vercel, Supabase, api-tennis, Resend: caps and notifications before ad spend.
- [ ] **Privacy & ads compliance** — Privacy policy, data collection disclosure; cookie/consent if EU/UK/CA users and analytics/ads pixels apply.

---

## Dependency audit (npm)

| Item | Severity | Notes |
|------|----------|--------|
| `next` 10.0.0 – 16.1.6 | Moderate | Multiple GHSA entries bundled under one audit line; upgrade path suggested to 16.2.0+ (verify with `npm audit` after bump). |

Re-run periodically:

```bash
npm audit
```

---

## What looked solid

- Cron routes: `CRON_SECRET`, fail closed if secret missing in production (`src/app/api/cron/*`).
- `/api/sandbox/simulate`: auth required, `points` validated, capped (`MAX_SANDBOX_POINTS`).
- `/api/admin/set-tournament-status`: user + `ADMIN_USER_IDS` in production.
- Service role: server-only (`src/lib/supabase/admin.ts`).
- No `dangerouslySetInnerHTML`, `eval`, or obvious raw SQL in app TS/TSX.

---

## Code & config risks

- [ ] **Development-only bypasses** — In `NODE_ENV === 'development'`, cron auth is open and admin tournament-status API skips admin user check. Do not expose dev server to the internet.
- [ ] **Middleware route coverage** — `src/lib/supabase/middleware.ts` only lists `/dashboard`, `/profile`, `/leagues`, `/predict` as protected prefixes; other routes rely on page-level auth. Re-check when adding routes.
- [ ] **`next.config.ts`: `typescript.ignoreBuildErrors: true`** — Allows shipping with type errors; increases bug/reliability risk. Remove when the project type-checks clean.
- [ ] **Optional HTTP hardening** — Consider security headers (CSP, HSTS, etc.) via Next/Vercel config.
- [ ] **Rate limiting** — No app-level limits on auth or high-value POSTs; optional hardening for abuse under ad traffic.
- [ ] **`pdf-parse` (admin)** — Untrusted PDFs can be CPU/memory heavy; keep uploads size-limited and server-only; watch package advisories.

---

## Where to look in the repo

| Topic | Location |
|-------|----------|
| External tennis API | `src/lib/tennis/providers/api-tennis.ts`, `src/app/api/cron/sync-tournaments/route.ts` |
| Next.js API routes | `src/app/api/**/route.ts` |
| Cron schedules | `vercel.json` |
| Admin triggers | `src/app/admin/actions.ts` |
| OAuth callback | `src/app/auth/callback/route.ts` |

---

## Public launch risk summary (qualitative)

- **Organic / soft launch:** Acceptable if production env and RLS are correct; still patch Next and fix the OAuth `next` param before heavy use.
- **Paid ads at scale:** Treat as **moderate risk** until the pre-launch checklist above is largely done; remaining exposure is often **operational** (cost, spam, compliance) rather than a single CVE.

---

*Last updated: March 2026*
