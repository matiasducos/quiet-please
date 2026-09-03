-- Migration: 105_predictions_board_order
-- Description: Index the tournament board's own ordering, so a rank can be
--              counted without walking every entry in the tournament.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHY
--
-- The "Your tournament" panel now shows where the visitor's bracket sits on
-- that tournament's leaderboard. Rank is a count of the entries above it,
-- under the same ordering the board itself uses:
--
--   ORDER BY points_earned DESC, id ASC
--
-- which makes the count
--
--   points_earned > mine OR (points_earned = mine AND id < my_id)
--
-- The closest existing index is 076's
--
--   idx_predictions_tournament_global (tournament_id) WHERE challenge_id IS NULL
--
-- That narrows to the tournament, then reads the heap for every one of its
-- entries to test points_earned. At today's ~120 entrants that is free; at the
-- 10k the app is built for it is 10k heap fetches on a page that renders on
-- every edition view, for a number that is one index range scan away.
--
-- Adding points_earned and id to the key makes both halves of the OR a range
-- scan on the index alone, and the same index serves the board's paged
-- ORDER BY — which is the query it was actually copied from.
--
-- NOT DROPPING 076's INDEX
--
-- This one has the same leading column and the same partial predicate, so it
-- is a strict superset and 076's is now redundant for lookups. Left in place
-- regardless: dropping it is a separate decision with its own blast radius
-- (the recap builder and the completion mailer both lean on it), and a
-- redundant index costs writes, not correctness.
-- ============================================================

create index if not exists idx_predictions_board_order
  on public.predictions (tournament_id, points_earned desc, id)
  where challenge_id is null;
