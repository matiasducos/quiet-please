-- Migration: 049_fix_public_league_season
-- Description: Fix seeded public leagues (migration 047) showing 0 pts for members.
--
-- Root cause: the seeded leagues inherited `season_start_date = now()` from the
-- column default, so the recalc function (`t.starts_at >= season_start_date`)
-- excluded every tournament that started BEFORE the migration ran.
--
-- Fix: backdate `season_start_date` to 52 weeks ago for the seeded public leagues
-- so the rolling-window behavior applies (the intended semantics for ongoing
-- public leagues). Then recalculate points for all members.
--
-- Safe to re-run: UPDATE is idempotent and only targets the 12 seeded leagues.
-- Run manually in Supabase dashboard.

UPDATE public.leagues
SET season_start_date = now() - interval '52 weeks'
WHERE is_public = true
  AND name IN (
    'Clay Court Kings', 'Grass Whisperers', 'Hardcourt Hustlers',
    'Grand Slam Chasers', 'Masters Minds', 'ATP Insiders',
    'WTA Watch', 'Upset Hunters', 'Weekend Warriors',
    'The Bracket Lab', '250 Grinders', 'All Surface All Day'
  );

-- Recalculate points for every member of those leagues
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT lm.league_id, lm.user_id
    FROM public.league_members lm
    JOIN public.leagues l ON l.id = lm.league_id
    WHERE l.is_public = true
      AND l.name IN (
        'Clay Court Kings', 'Grass Whisperers', 'Hardcourt Hustlers',
        'Grand Slam Chasers', 'Masters Minds', 'ATP Insiders',
        'WTA Watch', 'Upset Hunters', 'Weekend Warriors',
        'The Bracket Lab', '250 Grinders', 'All Surface All Day'
      )
  LOOP
    PERFORM public.recalculate_member_points(rec.league_id, rec.user_id);
  END LOOP;
  RAISE NOTICE 'Points recalculated for all seeded public league members';
END $$;
