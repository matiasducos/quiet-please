-- 087: "tell me when this draw is out" — for visitors with no account
--
-- The gap this closes: /tournaments/<slug>/<year> for an UPCOMING edition is
-- the page organic search lands on months before the event, and until now it
-- had nothing to offer that visitor. The draw isn't published, so there is no
-- bracket to fill in, and every CTA on the page is gated behind a draw that
-- does not exist yet. They read one paragraph saying "come back later" and
-- leave with nothing capturing the intent that brought them.
--
-- An address left here is the only thing on the page that survives the visit.
--
-- Deliberately NOT a row in `users`. Asking for an account before we have
-- anything to give is exactly the wall the /play flow (085) was built to
-- remove, and the same reasoning applies a step earlier in the funnel: the
-- account is what they create when the draw lands and there is a bracket worth
-- keeping, not the toll for being told it landed.

CREATE TABLE IF NOT EXISTS draw_reminders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,

  -- Nullable on purpose, and normally set. It is erased at send time (see
  -- notified_at below), which is the only state in which it is NULL.
  -- Always stored lower-cased by the caller so the unique constraint below
  -- actually dedupes.
  email          text,

  -- Bearer token for /api/unsubscribe/anonymous. Same role as the column of
  -- the same name on anonymous_predictions: these people have no user row, so
  -- there is no users.unsubscribe_token to resolve against.
  email_token    uuid NOT NULL DEFAULT gen_random_uuid(),

  -- Set when the draw-open mail for this tournament went out. The address is
  -- erased in the same write: it was collected for exactly one message, and an
  -- address kept past its purpose is a liability. The row survives the erasure
  -- so the funnel stays countable — how many reminders were asked for, how
  -- many were delivered — without holding anyone's data to do it.
  notified_at    timestamptz,

  -- Which surface captured it. One value today ('edition'), but the hub page
  -- and the slam landings are the obvious next two, and a fan-out that cannot
  -- say where its addresses came from cannot tell which page is working.
  source         text NOT NULL DEFAULT 'edition',

  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE draw_reminders IS
  'Signed-out visitors asking to be emailed once, when a tournament draw is '
  'published. Fanned out by announceDrawOpen(); the address is erased on send.';

COMMENT ON COLUMN draw_reminders.email IS
  'Lower-cased at write time. NULL means the reminder has already been sent '
  'and the address erased — see notified_at.';

-- Re-submitting the same address is the common case (someone forgets they
-- already asked, or double-clicks) and must be a no-op rather than a second
-- email. Named so the upsert can target it by constraint.
--
-- Erased rows carry email NULL and never conflict, which is the behaviour we
-- want: a visitor who asks again for a NEXT edition of the same tournament is
-- a different row anyway, and one who asks again for this one after it already
-- fired should not be silently swallowed.
ALTER TABLE draw_reminders
  DROP CONSTRAINT IF EXISTS draw_reminders_tournament_email_key;
ALTER TABLE draw_reminders
  ADD CONSTRAINT draw_reminders_tournament_email_key UNIQUE (tournament_id, email);

-- The fan-out's own query: "who is waiting on this draw?". Partial, because
-- every row is dead weight to it the moment it has been sent.
CREATE INDEX IF NOT EXISTS idx_draw_reminders_pending
  ON draw_reminders (tournament_id)
  WHERE email IS NOT NULL AND notified_at IS NULL;

-- Unsubscribe resolves a bearer token to a row.
CREATE INDEX IF NOT EXISTS idx_draw_reminders_email_token
  ON draw_reminders (email_token);

-- RLS on with no policies at all — the same posture as anonymous_predictions
-- (085). There is no session to scope a policy to, so every read and write
-- goes through the admin client in a server action. A permissive anon policy
-- would turn this into a public mailing list anyone could read.
ALTER TABLE draw_reminders ENABLE ROW LEVEL SECURITY;
