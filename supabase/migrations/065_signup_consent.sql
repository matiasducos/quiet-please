-- Migration: 065_signup_consent
-- Description: Record explicit Terms/Privacy acceptance and 16+ age confirmation
-- captured at /setup-username, the one screen every new account passes through.
--
-- Why columns on users and not an append-only consent log: the app only ever
-- needs the current state ("has this user accepted the live terms?"), which is
-- a single O(1) read on a row we already fetch. The tradeoff is that a future
-- re-acceptance overwrites the previous one rather than appending history — if
-- a dispute ever needs the full chain, move to a user_consents table then.

alter table public.users
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists age_confirmed_at timestamptz;

comment on column public.users.terms_accepted_at is
  'When the user explicitly ticked the Terms of Service + Privacy Policy box.';
comment on column public.users.terms_version is
  'Value of TERMS_VERSION (src/lib/legal/terms.ts) at acceptance time. Lets us re-prompt only the users who accepted an older version.';
comment on column public.users.age_confirmed_at is
  'When the user confirmed they are 16 or older (GDPR Art. 8 digital consent age in Latvia).';

-- Accounts created before this migration accepted via the passive "by creating
-- an account you agree to..." notice that has been on /signup since launch.
-- That is a real, if weaker, acceptance, so record it as such rather than
-- leaving NULL — NULL is ambiguous between "never asked" and "declined", and
-- these users never revisit /setup-username to be asked again.
update public.users
set terms_accepted_at = coalesce(terms_accepted_at, created_at),
    terms_version = coalesce(terms_version, 'legacy-passive-notice')
where username_is_set = true
  and terms_accepted_at is null;

-- Deliberately NOT backfilling age_confirmed_at: existing users were never
-- asked their age, and inventing a confirmation they never made would be
-- exactly the kind of record that is worse than no record at all.
