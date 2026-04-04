# Security & Vulnerabilities — Tracking

Actionable follow-ups from a codebase review (March 2026). Check items off as you address them.

---

## Pre-launch checklist (paid ads / public traffic)

- [ ] **Supabase Security Advisor** — Run in dashboard; fix RLS / policy warnings before scaling traffic.
- [ ] **Billing / abuse alerts** — Vercel, Supabase, api-tennis, Resend: caps and notifications before ad spend.

---

## Dependency audit (npm)

Re-run periodically:

```bash
npm audit
```

---

## Code & config risks

- [ ] **`pdf-parse` (admin)** — Untrusted PDFs can be CPU/memory heavy; keep uploads size-limited and server-only; watch package advisories.

---

## What looked solid

- Cron routes: `CRON_SECRET`, fail closed if secret missing in production (`src/app/api/cron/*`).
- `/api/sandbox/simulate`: auth required, `points` validated, capped (`MAX_SANDBOX_POINTS`).
- `/api/admin/set-tournament-status`: user + `ADMIN_USER_IDS` in production.
- Service role: server-only (`src/lib/supabase/admin.ts`).
- No `dangerouslySetInnerHTML`, `eval`, or obvious raw SQL in app TS/TSX.
- Development-only bypasses are intentional DX shortcuts — never expose dev server to internet.
- Middleware protects `/dashboard`, `/profile`, `/predict`, `/friends`, `/notifications`, `/admin`, `/leagues/browse`, `/leagues/new`, `/leagues/join`, `/challenges/new`. Other routes use page-level or action-level auth.

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

- **Organic / soft launch:** ✅ Acceptable — production env, RLS, OAuth hardened, security headers + CSP (enforced), rate limiting in place, type checking enforced.
- **Paid ads at scale:** Treat as **low risk** — remaining items are operational (Supabase Security Advisor, billing alerts, `pdf-parse` monitoring). All code-level security items are addressed.

---

*Last updated: April 4, 2026*
