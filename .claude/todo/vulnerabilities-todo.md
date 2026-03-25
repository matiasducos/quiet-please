# Security & vulnerabilities — tracking

Actionable follow-ups from a codebase review (March 2026). Check items off as you address them.

---

## Pre-launch checklist (paid ads / public traffic)

- [x] **Upgrade Next.js** ✅ 2026-03-25 — Already on 16.2.1, past vulnerable range. `flatted` prototype pollution also fixed via `npm audit fix`.
- [x] **Harden OAuth callback redirect** ✅ 2026-03-25 — `getSafeRedirectPath()` validates `next` param: must start with `/`, rejects `//`, rejects protocol schemes and backslash tricks.
- [x] **Production surface: `/test-tournaments`** ✅ 2026-03-25 — Gated with `requireAdmin()` on page + `requireAdminAction()` on server actions.
- [ ] **Supabase Security Advisor** — Run in dashboard; fix RLS / policy warnings before scaling traffic.
- [x] **Secrets hygiene** ✅ 2026-03-25 — Audited: no `.env` files ever committed, `.gitignore` covers `.env*`, no real keys in docs/README.
- [ ] **Billing / abuse alerts** — Vercel, Supabase, api-tennis, Resend: caps and notifications before ad spend.
- [x] **Privacy & ads compliance** ✅ 2026-03-25 — Privacy Policy (`/privacy`), Terms of Service (`/terms`), consent on signup/login, email unsubscribe, Footer with legal links. Remaining: cookie consent banner (tracked in `legal_todo.md`).

---

## Dependency audit (npm)

| Item | Severity | Notes |
|------|----------|--------|
| ~~`next` 10.0.0 – 16.1.6~~ | ~~Moderate~~ | ✅ Resolved — on 16.2.1 |
| ~~`flatted` ≤3.4.1~~ | ~~High~~ | ✅ Fixed via `npm audit fix` |

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
- [x] **Middleware route coverage** ✅ 2026-03-25 — Audited: middleware protects `/dashboard`, `/profile`, `/predict`. All other routes use page-level or action-level auth. Public routes intentionally show gate UI.
- [ ] **`next.config.ts`: `typescript.ignoreBuildErrors: true`** — Allows shipping with type errors; increases bug/reliability risk. Remove when the project type-checks clean (20+ errors, mostly stale `database.ts` types).
- [x] **HTTP hardening** ✅ 2026-03-25 — Security headers in `next.config.ts`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS (2yr + preload), `Permissions-Policy`. CSP deferred (needs testing with Next.js inline scripts).
- [x] **Rate limiting** ✅ 2026-03-25 — Audited: Supabase Auth handles login/signup natively. App-level limits cover challenges (5/min), predictions (20/min), friend requests (10/min), anonymous challenges (3/hr per IP).
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

- **Organic / soft launch:** ✅ Acceptable — production env, RLS, OAuth hardened, security headers added, rate limiting in place.
- **Paid ads at scale:** Treat as **low-moderate risk** — remaining items are operational (Supabase Security Advisor, billing alerts) and one config cleanup (`ignoreBuildErrors`).

---

*Last updated: March 25, 2026*
