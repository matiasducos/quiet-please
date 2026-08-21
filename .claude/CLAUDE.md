# Claude Code Guidelines — Quiet Please

## Critical Rules

### Mobile First
- **Every UI change MUST be verified at mobile width (375px).** Use `preview_resize` with mobile preset after any UI edit.
- Write responsive styles mobile-first: use `px-4 md:px-8` not `px-8`. Small screen is the default.
- Tables with `grid-cols-12` must be wrapped in `overflow-x-auto` with a `min-w-[...]` inner div.
- Never hardcode padding larger than `px-4` without a responsive breakpoint.

### Scalability First
- **NEVER implement non-scalable solutions.** The app targets 10k+ users.
- Always use targeted queries (e.g. `recalculate_member_points(league_id, user_id)` not `recalculate_league_points()` for all leagues).
- Avoid O(n) operations where O(1) is possible.
- Prefer pushing filters to the database layer. If PostgREST can't filter on nested relations, filter client-side but keep result sets small with LIMIT.

### Supabase
- Project is NOT linked locally — migrations must be run manually in the Supabase dashboard.
- Latest migration: `088_tournament_seasons.sql` (remember to bump this file when you add a new migration)
- Migration numbers must reflect the order they were APPLIED, not written. 066/067 are a permanent gap — those numbers were never applied to any database.

### Cookies & consent
- **Any new non-essential cookie MUST be gated on `canStore` in `middleware.ts`.** Only auth, `username_is_set` and `qp_consent` are exempt (strictly necessary).
- The banner is shown to EEA/UK visitors only, decided from `x-vercel-ip-country` and **failing closed** — no header means ask. `src/lib/consent.ts` owns that rule.
- PostHog persistence follows consent: `localStorage+cookie` when allowed, `memory` otherwise. Never hardcode it back.
- Adding a new purpose or processor → bump `CONSENT_VERSION` so stored decisions are re-asked, and update the cookie table in `/privacy`.
- Accept and Decline must stay the same size, shape and one click each. Unequal prominence is the most commonly enforced banner defect.

### Notifications
- When adding a new notification type, update 4 places:
  1. DB constraint migration (CHECK type IN ...)
  2. Insert in the server action
  3. `TYPE_META` + `getHref()` + message template in `src/app/notifications/page.tsx`

### Forms
- Use `useFormStatus` (in a child component) for submit button loading states, not `useState`.
