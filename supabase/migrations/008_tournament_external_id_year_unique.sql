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
-- Expression-based indexes (e.g. date_trunc('year', starts_at)) require
-- IMMUTABLE functions, but all timestamptz manipulation is STABLE (timezone-
-- dependent).  The clean solution: a real starts_year column that is set by
-- application code on every insert/update of starts_at.
--
-- This migration:
--   1. Drops the old single-column UNIQUE constraint on external_id
--   2. Adds a starts_year smallint column
--   3. Backfills starts_year for all existing rows
--   4. Creates a composite unique index on (external_id, starts_year)

-- 1. Drop existing single-column unique constraint
ALTER TABLE public.tournaments
  DROP CONSTRAINT IF EXISTS tournaments_external_id_key;

-- 2. Add the year column (nullable — NULL means "year not known yet")
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS starts_year smallint;

-- 3. Backfill starts_year for all rows that already have starts_at
--    EXTRACT(YEAR FROM … AT TIME ZONE 'UTC') works fine in a plain UPDATE
--    (STABLE is fine outside of index expressions)
UPDATE public.tournaments
  SET starts_year = EXTRACT(YEAR FROM starts_at AT TIME ZONE 'UTC')::smallint
  WHERE starts_at IS NOT NULL;

-- 4. New uniqueness: one row per (external_id, year).
--    Plain columns — no expression immutability issues.
--    NULL starts_year rows are treated as distinct (PG unique index NULL semantics).
CREATE UNIQUE INDEX IF NOT EXISTS tournaments_external_id_year_key
  ON public.tournaments (external_id, starts_year);
