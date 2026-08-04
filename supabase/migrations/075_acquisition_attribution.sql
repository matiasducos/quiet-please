-- 075: record where each account came from
--
-- The PostHog browser client runs cookieless (persistence: 'memory'), so the
-- anonymous distinct_id is reminted on every full page load. Signup has
-- several — the OAuth round trip through /auth/callback, the email
-- confirmation link, the middleware redirect to /setup-username — so the
-- visitor who landed from a campaign and the user who fires signup_completed
-- are unrelated person records in PostHog, with nothing to join them on.
-- Measured before this change: `/` reported 21 persons across 21 sessions.
--
-- These columns are the durable side of the fix. Middleware stamps a
-- first-touch cookie on the landing request and setUsername() — the one screen
-- every account passes through exactly once — writes it here. Storing it on
-- the user row rather than only on the event means channel performance stays
-- answerable with a plain GROUP BY, and survives any future analytics change.
--
-- Discrete columns rather than jsonb: source/medium/campaign are the
-- dimensions you group by, and an index on a real column beats one on a
-- jsonb path expression for the only query these ever serve.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS acq_source       text,
  ADD COLUMN IF NOT EXISTS acq_medium       text,
  ADD COLUMN IF NOT EXISTS acq_campaign     text,
  ADD COLUMN IF NOT EXISTS acq_referrer     text,
  ADD COLUMN IF NOT EXISTS acq_landing_path text;

COMMENT ON COLUMN users.acq_source IS
  'First-touch acquisition source: utm_source, else a paid click-id vendor '
  '(gclid -> google), else the referring domain, else ''direct''. '
  'Written once by setUsername(); NULL for accounts created before 075.';
COMMENT ON COLUMN users.acq_medium IS
  'First-touch utm_medium; ''referral'' for an external referrer, ''none'' for direct.';
COMMENT ON COLUMN users.acq_campaign IS 'First-touch utm_campaign, when present.';
COMMENT ON COLUMN users.acq_referrer IS 'Referring hostname of the landing request, www- stripped.';
COMMENT ON COLUMN users.acq_landing_path IS
  'Path the visitor first landed on — distinguishes a homepage arrival from a '
  'Grand Slam landing page or a shared challenge link.';

-- Partial: the only question asked of these columns is "how did attributed
-- signups break down", so rows that predate attribution are dead weight.
CREATE INDEX IF NOT EXISTS users_acq_source_idx
  ON users (acq_source)
  WHERE acq_source IS NOT NULL;
