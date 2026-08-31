-- Migration: 097_predictions_is_published
-- Description: Make "has this bracket been published by its owner?" a column,
--              so the surfaces that FILTER on it can push the filter into the
--              database instead of guessing.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHY A COLUMN AND NOT THE TypeScript HELPER
--
-- The leaderboard and league tables load their rows anyway, so they could
-- answer this in memory (hasPublishedPicks did). The profile, the league
-- activity feed and the league landing feed cannot: all three are
-- `ORDER BY submitted_at DESC LIMIT n` queries, so a filter applied after the
-- fetch under-fills the page — ask for 50, render fewer, and the shortfall
-- grows with the number of unpublished brackets. Over-fetching to compensate
-- is a guess, not a fix.
--
-- Making it a STORED generated column lets PostgREST filter and the index
-- serve it, which keeps those feeds O(limit) rather than O(members).
--
-- IT ALSO COLLAPSES TWO DEFINITIONS INTO ONE
--
-- This rule was briefly written twice — once in the tables deciding whether to
-- OFFER a bracket, once in the picks page deciding whether to SERVE it. They
-- disagreed, and the result was a "view picks" link that 404'd. One definition
-- in one place is the actual fix; hasPublishedPicks() is deleted in the same
-- change that adds this.
--
-- THE 'auto' EXCLUSION IS THE WHOLE POINT
--
-- award-points stamps pick_locks[matchId] = 'auto' on every scored pick after
-- its match is decided. It is a record of scoring, not a commitment. A plain
-- "are there any locks" test would therefore publish the bracket of everybody
-- who has ever scored a point, without them ever locking anything — an opt-in
-- reveal turned automatic. Five live brackets are in exactly that shape today.
-- So this mirrors COMMITTED_LOCK_TYPES in src/lib/tennis/points.ts:
-- 'voluntary' | 'round' | 'auto_lock_all', and never 'auto'. Those two lists
-- have to move together.
--
-- NULL SAFETY IS NOT DECORATION
--
-- Without the COALESCEs, a NULL pick_locks makes the expression
-- `false OR NULL` = NULL rather than false. The column then reads NULL for
-- rows that are simply unpublished, and any future `.neq('is_published', true)`
-- silently drops them — the .neq()-drops-NULLs trap. No row has a NULL
-- pick_locks today; this makes sure the column cannot grow one.
-- ============================================================

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN
  GENERATED ALWAYS AS (
    COALESCE(is_fully_locked, FALSE)
    OR COALESCE(
         jsonb_path_exists(
           COALESCE(pick_locks, '{}'::jsonb),
           '$.* ? (@ == "voluntary" || @ == "round" || @ == "auto_lock_all")'
         ), FALSE)
  ) STORED;

COMMENT ON COLUMN public.predictions.is_published IS
  'True once the owner has committed ANY round, or locked the whole bracket. Gates who may view this bracket. Excludes the award-points cron''s post-match ''auto'' marks, which are a scoring record and not a commitment. Mirrors COMMITTED_LOCK_TYPES in src/lib/tennis/points.ts.';

-- The three feeds this exists for are all "newest published brackets for these
-- members", so the index carries the sort column too and they never leave it.
CREATE INDEX IF NOT EXISTS idx_predictions_published_recent
  ON public.predictions (user_id, submitted_at DESC)
  WHERE is_published AND challenge_id IS NULL;
