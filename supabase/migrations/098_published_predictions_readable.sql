-- Migration: 098_published_predictions_readable
-- Description: Move the public-read RLS policy onto is_published, so a bracket
--              committed round by round is readable by other users — the other
--              half of 097.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHY 097 WAS NOT ENOUGH ON ITS OWN
--
-- 097 changed what the APP asks for. 030 governs what the DATABASE will hand
-- over, and it still said:
--
--   USING (is_fully_locked = true AND challenge_id IS NULL)
--
-- Every surface that reads predictions through the request-scoped client — the
-- profile — therefore kept returning only fully-locked brackets no matter what
-- the query filtered on. The change looked inert there while working fine on
-- the leaderboard and the league feeds, and the reason is simply that those
-- three use the admin client and never consult this policy at all.
--
-- Fixing the policy is the change. Switching the profile to the admin client
-- would have "worked" and quietly removed row-level security from a page that
-- renders another user's data.
--
-- SCOPE IS UNCHANGED APART FROM THE RULE ITSELF
--
-- Still global predictions only: `challenge_id IS NULL` stays, so a challenge
-- bracket is never made public by this policy. The poker rule that hides a
-- challenge opponent until both sides lock lives in the app and in
-- "Users can read challenge predictions they participate in" (015), and both
-- are untouched.
--
-- is_published cannot be NULL by construction (097 coalesces both inputs), so
-- there is no third state for this predicate to fall through.
-- ============================================================

DROP POLICY IF EXISTS "Locked global predictions are publicly readable" ON public.predictions;
DROP POLICY IF EXISTS "Published global predictions are publicly readable" ON public.predictions;

CREATE POLICY "Published global predictions are publicly readable"
  ON public.predictions FOR SELECT
  USING (is_published = TRUE AND challenge_id IS NULL);
