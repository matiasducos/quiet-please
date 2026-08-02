-- 070: announce a draw at most once per tournament
--
-- announceDrawOpen() ran on every admin save that had "open predictions"
-- ticked, so editing and re-saving a published draw sent the whole user base a
-- second in-app notification and a second "The draw is open." email.
--
-- The guard has to live in the database rather than in app code: there are
-- three call sites (buildDraw, saveManualDraw, sync-draws) and any two of them
-- can overlap, so a read-then-write check in TypeScript would still let both
-- through. A conditional UPDATE ... WHERE draw_announced_at IS NULL is settled
-- by row locking, so exactly one caller wins the claim.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS draw_announced_at timestamptz;

COMMENT ON COLUMN tournaments.draw_announced_at IS
  'When the draw-open announcement (in-app notification + email) was sent. '
  'NULL means not sent yet; announceDrawOpen() claims it atomically. '
  'Set it back to NULL to deliberately re-announce a draw.';

-- Backfill. Every tournament whose draw is already open has had its
-- announcement, so without this the next save of any live draw would notify
-- everyone a second time — the exact bug above. Prefer the timestamp of the
-- first draw_open notification, fall back to when the draw was stored, and
-- finally to now() so no live tournament is left unclaimed.
UPDATE tournaments t
SET draw_announced_at = COALESCE(
  (SELECT min(n.created_at) FROM notifications n
     WHERE n.tournament_id = t.id AND n.type = 'draw_open'),
  (SELECT d.synced_at FROM draws d WHERE d.tournament_id = t.id),
  now()
)
WHERE t.draw_announced_at IS NULL
  AND t.status IN ('accepting_predictions', 'in_progress', 'completed');

-- Tournaments still at 'upcoming' or 'draw_published' are left NULL on purpose:
-- announceDrawOpen() only fires on the move to accepting_predictions, so those
-- have genuinely never been announced and still should be.
