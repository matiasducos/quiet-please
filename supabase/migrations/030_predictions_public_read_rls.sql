-- ── 030: Allow reading locked global predictions publicly ───────────────────
--
-- Problem: The only SELECT policy on predictions is scoped to auth.uid() = user_id
-- (own predictions) OR challenge predictions the user participates in. This blocks
-- reading other users' locked global predictions on their profile pages.
--
-- Fix: Add a policy that makes fully-locked global predictions readable by any
-- authenticated user. This is correct business logic — once a bracket is locked,
-- it's public (shown on profile pages, leaderboards, friend activity, etc.).
--
-- The existing policy "Users can read challenge predictions they participate in"
-- still covers own predictions (any state) and challenge opponent predictions.

CREATE POLICY "Locked global predictions are publicly readable"
  ON public.predictions FOR SELECT
  USING (is_fully_locked = true AND challenge_id IS NULL);
