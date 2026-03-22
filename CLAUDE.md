# Claude Code Guidelines — Quiet Please

## Critical Rules

### Scalability First
- **NEVER implement non-scalable solutions.** The app targets 10k+ users.
- Always use targeted queries (e.g. `recalculate_member_points(league_id, user_id)` not `recalculate_league_points()` for all leagues).
- Avoid O(n) operations where O(1) is possible.
- Prefer pushing filters to the database layer. If PostgREST can't filter on nested relations, filter client-side but keep result sets small with LIMIT.

### Supabase
- Project is NOT linked locally — migrations must be run manually in the Supabase dashboard.
- Latest migration: `025_recalculate_member_points.sql`

### Notifications
- When adding a new notification type, update 4 places:
  1. DB constraint migration (CHECK type IN ...)
  2. Insert in the server action
  3. `TYPE_META` + `getHref()` + message template in `src/app/notifications/page.tsx`

### Forms
- Use `useFormStatus` (in a child component) for submit button loading states, not `useState`.
