-- 008_tournament_external_id_year_unique
--
-- api-tennis.com uses a single stable tournament_key per tournament regardless
-- of year (e.g., "Australian Open" always has the same key).  tournament_date
-- gives the CURRENT year's occurrence date.
--
-- To support per-year entries (Australian Open 2025 and Australian Open 2026 as
-- separate rows, each with their own draws / results / predictions), we need:
--   one row per (external_id, year) rather than one row per external_id.
--
-- This migration:
--   1. Drops the old single-column UNIQUE constraint
--   2. Adds a composite unique index on (external_id, year-of starts_at)

-- Drop existing single-column unique constraint
ALTER TABLE public.tournaments
  DROP CONSTRAINT IF EXISTS tournaments_external_id_key;

-- New uniqueness: one row per (external_id, year).
-- NULL starts_at rows are treated as distinct from each other by PG unique
-- index semantics, so they will never conflict.
CREATE UNIQUE INDEX IF NOT EXISTS tournaments_external_id_year_key
  ON public.tournaments (external_id, date_trunc('year', starts_at));
