-- 109: split the draw-open email from the draw-open announcement
--
-- Publishing a draw used to send the whole user base an email on the spot, so
-- two draws built in one admin session — which is how same-week tournaments are
-- always entered, minutes apart — cost two emails per user. On Resend's free
-- plan (100/day) that is most of the day's quota gone on one announcement.
--
-- Now publishing only claims `draw_announced_at` and writes the in-app
-- notifications. The email is pending until sendPendingDrawEmails() claims
-- every announced-but-unmailed tournament at once and sends each user ONE
-- email covering all of them. It runs from the admin "Send email" button and,
-- as a safety net, from the daily expire-points cron.
--
-- Same at-most-once contract as 070: the claim is a conditional UPDATE ...
-- WHERE draw_emailed_at IS NULL, so the button and the cron cannot both send.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS draw_emailed_at timestamptz;

COMMENT ON COLUMN tournaments.draw_emailed_at IS
  'When the draw-open email went out (or was deliberately skipped). NULL with '
  'draw_announced_at set means the email is pending; sendPendingDrawEmails() '
  'claims it atomically. Set it back to NULL to deliberately re-send.';

-- Backfill. Every draw announced before this migration was emailed at the same
-- moment, so without this the first pending send would re-mail every past
-- tournament.
UPDATE tournaments
SET draw_emailed_at = draw_announced_at
WHERE draw_announced_at IS NOT NULL
  AND draw_emailed_at IS NULL;
