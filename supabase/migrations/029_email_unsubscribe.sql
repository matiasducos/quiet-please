-- Migration: 029_email_unsubscribe
-- Description: Add email_notifications column to users table for global opt-out.
-- Each user gets a unique unsubscribe_token for one-click email unsubscribe (no login required).

alter table public.users
  add column if not exists email_notifications boolean not null default true;

alter table public.users
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

-- Index for fast lookup by unsubscribe token (used by the /api/unsubscribe route)
create unique index if not exists idx_users_unsubscribe_token on public.users (unsubscribe_token);
