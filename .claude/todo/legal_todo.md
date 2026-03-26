# Legal Todo — Quiet Please

## Phase 1 — ✅ Shipped March 25, 2026
- ✅ Privacy Policy page (`/privacy`)
- ✅ Terms of Service page (`/terms`)
- ✅ Consent text on signup and login pages
- ✅ Email unsubscribe mechanism (DB column + one-click link + cron filtering)
- ✅ Footer with legal links (Terms, Privacy, Contact)
- ⬜ Run migration `029_email_unsubscribe.sql` in Supabase dashboard
- ⬜ Set up `support@quietplease.app` mailbox

## Phase 2 — High Priority
- ⬜ Cookie consent banner (Vercel Analytics + `username_is_set` cookie)
- ⬜ Age gate — confirm 16+ at signup
- ⬜ Self-host Google Fonts (eliminate IP sharing with Google)
- ⬜ Add gambling disclaimer to homepage/footer: "Free prediction game for entertainment only. No real money or prizes."

## Phase 3 — Account & Email
- ⬜ Account deletion flow (GDPR Article 17 — Right to Erasure)
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
