-- 085: solo brackets filled in before the account exists
--
-- The acquisition funnel used to be: Instagram → homepage → tournament →
-- "Predict" → signup wall. The visitor is asked to create an account for a
-- product they have not touched once, and the wall lands at the exact moment
-- of highest intent and lowest investment. `/tournaments/[slug]/predict`
-- already carried a comment naming that click as "the single most likely
-- moment for someone without an account to hit a wall".
--
-- This table inverts the order. A visitor fills in a bracket first, it is
-- saved without a user row, and the account becomes the way to KEEP something
-- they already made rather than the toll to make it.
--
-- Deliberately its own table rather than a reuse of `challenges`. An
-- anonymous challenge is a 1v1 that carries finalization semantics, a
-- `waiting_opponent` status and a place in challenge counts; a solo bracket
-- has an opponent of nobody and would sit in that status forever, polluting
-- every challenge aggregate in the app.

CREATE TABLE IF NOT EXISTS anonymous_predictions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,

  -- Public half of the identity: the URL at /b/<share_code>. Safe to paste
  -- anywhere, confers read access only.
  share_code     text NOT NULL UNIQUE,
  -- Secret half: proves this browser is the author. Lives in localStorage and
  -- is what authorises claiming the bracket or attaching an email to it.
  -- Knowing the share code alone must never be enough to do either.
  token          uuid NOT NULL,

  display_name   text,
  picks          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Picks on matches that were already decided when the bracket was submitted.
  -- Scored as zero, exactly like predictions.locked_picks.
  --
  -- Load-bearing for integrity, not a nicety: this entry point is reachable
  -- mid-tournament by anyone with the link, so without it a visitor arriving
  -- on day six could fill in the results they already know, claim the bracket
  -- and bank real ranking points. The anonymous CHALLENGE flow only tags these
  -- when the global prediction mode is `manual_lock`; here they are tagged
  -- unconditionally, because a challenge affects nobody's ranking and a
  -- claimed solo bracket affects the global one.
  locked_picks   text[] NOT NULL DEFAULT '{}',

  -- Optional address, purpose-limited to one email when the tournament ends.
  -- Same shape and same reasoning as the anonymous challenge columns in 078.
  email             text,
  email_token       uuid,
  result_emailed_at timestamptz,

  -- Set when the author creates an account and the bracket is copied into a
  -- real `predictions` row. Kept (rather than deleted) so the conversion is
  -- measurable and /b/<code> keeps resolving for anyone holding the link.
  claimed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  claimed_at     timestamptz,
  prediction_id  uuid REFERENCES predictions(id) ON DELETE SET NULL,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE anonymous_predictions IS
  'Brackets filled in before an account exists. Claimed into predictions on '
  'signup; scoring is then handled by award-points like any other prediction.';

COMMENT ON COLUMN anonymous_predictions.token IS
  'Bearer secret held in the author''s localStorage. Required to claim the '
  'bracket or attach an email — the share code is public and grants read only.';

COMMENT ON COLUMN anonymous_predictions.locked_picks IS
  'Picks on matches already decided at submit time. Always populated, '
  'regardless of prediction mode — this surface is open to the public '
  'mid-tournament and is the one place backfilling known results would pay.';

COMMENT ON COLUMN anonymous_predictions.prediction_id IS
  'The predictions row created at claim time. Points are NOT backfilled here: '
  'award-points scores every (match_result, prediction) pair missing from '
  'point_ledger, so the next cron run picks up the whole tournament to date.';

-- No explicit share_code index: the UNIQUE constraint above already backs one,
-- and /b/<code> lookups use it.

-- "Which brackets does this tournament have?" — used by the result-email pass
-- and by the conversion funnel query.
CREATE INDEX IF NOT EXISTS idx_anonymous_predictions_tournament
  ON anonymous_predictions (tournament_id);

-- Unsubscribe resolves a bearer token to a row. Partial: the overwhelming
-- majority of brackets never carry an address.
CREATE INDEX IF NOT EXISTS idx_anonymous_predictions_email_token
  ON anonymous_predictions (email_token) WHERE email_token IS NOT NULL;

-- The unclaimed backlog — small by design, and the set the result email walks.
CREATE INDEX IF NOT EXISTS idx_anonymous_predictions_pending_email
  ON anonymous_predictions (tournament_id)
  WHERE email IS NOT NULL AND result_emailed_at IS NULL;

-- RLS on with no policies at all: every read and write goes through the admin
-- client from a server action. There is no session to scope a policy to — that
-- is the entire point of the table — so a permissive anon policy would be an
-- open door to every unclaimed bracket's token.
ALTER TABLE anonymous_predictions ENABLE ROW LEVEL SECURITY;

-- updated_at maintenance via the shared trigger function introduced in 072.
DROP TRIGGER IF EXISTS anonymous_predictions_touch_updated_at ON anonymous_predictions;
CREATE TRIGGER anonymous_predictions_touch_updated_at
  BEFORE UPDATE ON anonymous_predictions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
