-- 078: let an anonymous challenge player leave an email for the result
--
-- An anonymous player fills in an entire bracket from a friend's link and then
-- vanishes: there is no user row, no session that outlives localStorage, and
-- so no way to tell them they won when the tournament finishes. That result is
-- the single best moment to earn the account, and today we cannot reach it.
--
-- The address is optional and purpose-limited: one email, when this challenge
-- finishes. It is stored on the challenge rather than in a mailing list so the
-- scope is self-evident and erasure is a single UPDATE.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS creator_email              text,
  ADD COLUMN IF NOT EXISTS opponent_email             text,
  ADD COLUMN IF NOT EXISTS creator_email_token        uuid,
  ADD COLUMN IF NOT EXISTS opponent_email_token       uuid,
  ADD COLUMN IF NOT EXISTS creator_result_emailed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS opponent_result_emailed_at timestamptz;

COMMENT ON COLUMN challenges.creator_email IS
  'Optional address the anonymous creator left to be told the result. NULL when '
  'not given or after they opted out — the opt-out erases it rather than '
  'flagging it, because one email is the entire purpose we collected it for.';
COMMENT ON COLUMN challenges.creator_email_token IS
  'Bearer token for the unsubscribe link in that email. Minted alongside the '
  'address; anonymous players have no user row, so the users.unsubscribe_token '
  'path cannot serve them.';
COMMENT ON COLUMN challenges.creator_result_emailed_at IS
  'When the result email was sent. The send is driven off this being NULL, so a '
  'failed send is retried on the next cron pass and a succeeded one is never '
  'repeated.';

COMMENT ON COLUMN challenges.opponent_email IS 'See creator_email.';
COMMENT ON COLUMN challenges.opponent_email_token IS 'See creator_email_token.';
COMMENT ON COLUMN challenges.opponent_result_emailed_at IS 'See creator_result_emailed_at.';

-- Unsubscribe looks a token up across both columns. Partial indexes keep those
-- lookups off a sequential scan without indexing the (vast) majority of rows
-- that carry no address at all.
CREATE INDEX IF NOT EXISTS idx_challenges_creator_email_token
  ON challenges (creator_email_token) WHERE creator_email_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_challenges_opponent_email_token
  ON challenges (opponent_email_token) WHERE opponent_email_token IS NOT NULL;

-- The cron asks one question every run: "which finished challenges still owe
-- somebody an email?" Without this it is a full scan of challenges on every
-- award-points pass, growing with the table forever. With it the scan is
-- proportional to the backlog, which is normally zero.
CREATE INDEX IF NOT EXISTS idx_challenges_pending_result_email
  ON challenges (status)
  WHERE is_anonymous
    AND status = 'completed'
    AND (
      (creator_email  IS NOT NULL AND creator_result_emailed_at  IS NULL)
      OR (opponent_email IS NOT NULL AND opponent_result_emailed_at IS NULL)
    );
