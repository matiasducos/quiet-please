-- Migration: 050_account_deletion
-- Description: Add deletion_requested_at column for two-phase account deletion.
-- NULL = active account. Non-null = user requested deletion at that timestamp.
-- After 7 days, a cron job processes the actual deletion.
-- Run manually in Supabase dashboard (project not linked locally).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ DEFAULT NULL;
