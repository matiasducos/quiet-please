# Legal Todo — Quiet Please

## Phase 1 — Remaining
- ⬜ Run migration `029_email_unsubscribe.sql` in Supabase dashboard
- ⬜ Set up `support@quietplease.app` mailbox

## Phase 2 — High Priority
- ⬜ Cookie consent banner (Vercel Analytics + PostHog + `username_is_set` cookie) — **still open, and now the only unmet consent gap.** PostHog fires `$pageview`/`cta_clicked` for anonymous homepage visitors *before* any account exists, so the signup checkbox does not and cannot cover analytics consent.
- ⬜ Age gate — confirm 16+ at signup. **Briefly shipped 2026-07-30 then deliberately removed** the same day when the second checkbox was dropped in favour of a single one on `/signup`. The `users.age_confirmed_at` column from migration `065` still exists and is now always NULL — reuse it if the gate comes back.
- ✅ Explicit Terms/Privacy acceptance (2026-07-30) — one checkbox on `/signup`; `/auth/callback` records `terms_accepted_at` + `terms_version` from the `?consent=` param. Migration `065`.
  - ⚠️ Accounts created by signing in with Google from `/login` never see the checkbox and are left NULL by design. Query: `select count(*) from users where terms_accepted_at is null and username_is_set` to size the gap.
- ✅ Self-host Google Fonts (2026-04-04) — switched to next/font/google
- ⬜ Add gambling disclaimer to homepage/footer: "Free prediction game for entertainment only. No real money or prizes."

## Phase 3 — Account & Email
- ✅ Account deletion flow (GDPR Article 17 — Right to Erasure) — shipped in three parts, the checkbox was simply never ticked:
  - **Self-serve**: `requestAccountDeletion()` / `cancelAccountDeletion()` (`src/app/profile/deletion-actions.ts`), typed-username confirmation, sets `users.deletion_requested_at` (migration `050`). Nav shows a pending-deletion banner while the user can still cancel.
  - **Execution**: `/api/cron/process-deletions` nightly at 03:00 (`vercel.json`) once the 7-day grace period has elapsed.
  - **Admin**: `/admin/users` (2026-08-02) — search, deletion-impact preview, immediate delete that skips the grace period.
  - All three call one `deleteUserAccount()` (`src/lib/delete-user.ts`): transfers owned leagues to their longest-standing member, clears `challenges.winner_id` (its FK has no ON DELETE clause), then deletes the `auth.users` row so every child table cascades.
  - ✅ Audit trail (2026-08-02) — `admin_actions` (migration `071`) records actor, target, and an impact snapshot for every admin delete. Deliberately free of foreign keys so it outlives the rows it describes. Readable via SQL only; there is no viewer in the panel yet.
- ⬜ Email preferences page in account settings (re-subscribe option)
- ⬜ Content moderation: profanity filter on usernames, display names, league names
- ⬜ Copyright footer entity name (once LLC/entity is formed)

## Phase 4 — Ongoing / Lower Priority
- ⬜ Data Processing Agreements with Supabase, Vercel, Resend
- ⬜ Data export feature (GDPR Article 20 — Right to Data Portability)
- ⬜ Anonymous user data deletion mechanism
- ⬜ Review api-tennis.com licensing terms for data display
- ⬜ ATP/WTA trademark disclaimer on homepage
- ⬜ Responsible disclosure / security policy page
- ⬜ Accessibility statement

## Notes
- Operator: Quiet Please
- Contact: support@quietplease.app
- Minimum age: 16+
- No gambling/betting — free prediction game with virtual points only
- If prizes or real money are EVER added, gambling licensing is required in most jurisdictions
