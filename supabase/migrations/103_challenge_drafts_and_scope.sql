-- 103_challenge_drafts_and_scope.sql
--
-- Two changes to `challenges`, both in service of the same finding: two real
-- users have ever created a challenge, and no anonymous challenge link has ever
-- been opened by its recipient.
--
-- ── A. 'draft' status ───────────────────────────────────────────────────────
--
-- A friends challenge used to notify the moment it was created, before the
-- challenger had picked anything — so the recipient got "X challenged you" with
-- nothing behind it. The challenger now picks first and sends afterwards, which
-- needs a state that exists but is not yet visible to the other side.
--
-- 'draft' is deliberately a status rather than an `invited_at` timestamp: every
-- read path already switches on status, and a null timestamp on a 'pending' row
-- would be an invisible second meaning for a status that already renders.

ALTER TABLE public.challenges DROP CONSTRAINT IF EXISTS challenges_valid_status;
ALTER TABLE public.challenges ADD CONSTRAINT challenges_valid_status
  CHECK (status IN (
    'draft',
    'pending', 'accepted', 'declined', 'expired', 'completed', 'cancelled',
    'waiting_opponent', 'active'
  ));

-- The one-active-challenge-per-pair guard has to cover drafts too, or a user
-- could stack unlimited unsent drafts against the same friend and tournament
-- and then send them all at once. Recreated rather than altered: a partial
-- index's WHERE clause cannot be changed in place.
DROP INDEX IF EXISTS public.idx_challenges_active_pair;
CREATE UNIQUE INDEX idx_challenges_active_pair
  ON public.challenges (
    LEAST(challenger_id, challenged_id),
    GREATEST(challenger_id, challenged_id),
    tournament_id
  )
  WHERE status IN ('draft', 'pending', 'accepted');

-- ── B. scope_round ──────────────────────────────────────────────────────────
--
-- Which round a challenge starts from. NULL means the whole draw, which is what
-- every existing row is and stays.
--
-- A slam challenge is 127 picks each. Nobody fills that, and a half-filled
-- bracket against a full one is not a contest — more picks strictly dominates
-- for points, and the cron tiebreak rewards volume on top of that. A scoped
-- challenge is a fixed, small set of matches both sides actually complete.
--
-- Only a round whose participants are already determined by results may be
-- chosen (enforced in `src/lib/challenges/scope.ts`, not here — the check needs
-- the draw and the results, which is application knowledge). That keeps feed-in
-- real: every player name in a scoped bracket comes from a played match rather
-- than from a pick the user was never asked to make.
--
-- Unconstrained TEXT on purpose. A CHECK listing round codes would have to be
-- migrated in step with `ROUND_ORDER`, and the app already refuses to write
-- anything else.
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS scope_round TEXT;

COMMENT ON COLUMN public.challenges.scope_round IS
  'First round in scope, e.g. ''QF''. NULL = the whole draw. Set at creation only.';

-- ── C. source_bracket_id ────────────────────────────────────────────────────
--
-- The anonymous challenge a visitor started from a bracket they had already
-- saved at /play. `/challenges/create` — choose a tournament, fill a bracket,
-- share — drew two page views in 180 days and produced no challenge anyone
-- ever opened, while /play drew 170 people to the same bracket-filling
-- mechanic. So challenging becomes a button on a bracket that already exists.
--
-- Unique so the button is idempotent: pressing it twice returns the existing
-- challenge rather than minting a second link the author cannot tell apart.
ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS source_bracket_id UUID
  REFERENCES public.anonymous_predictions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_challenges_source_bracket
  ON public.challenges (source_bracket_id)
  WHERE source_bracket_id IS NOT NULL;

COMMENT ON COLUMN public.challenges.source_bracket_id IS
  'The /play bracket this challenge was staked from. NULL for every other challenge.';
