-- 104_points_email_upcoming.sql
--
-- Which ties the points email advertises as "up next".
--
-- The points email ("+380 pts — Cincinnati") is the only mail a mid-tournament
-- player reliably gets, and it looks backwards: it reports the round that just
-- finished and then stops. This column is what lets it also point forward, to
-- the matches whose results the next one of these emails will be about.
--
-- Admin-curated rather than derived, for the same reason the social "Up next"
-- card is: a quarterfinal round is eight ties and an email column fits three,
-- so *something* has to choose. Draw order is the wrong chooser — it puts the
-- top of the bracket on every card forever and buries the tie people care
-- about. The admin is present when this matters, because award-points is
-- hand-triggered (it is not in vercel.json), so the choice is made minutes
-- before the mail it affects goes out.
--
-- Three states, and the null/empty distinction is load-bearing — it is the same
-- contract the social card's `matches` query param already uses (see the
-- comment above `matchIds` in the studio's image route):
--
--   NULL  → auto. Take the earliest pending round and use the first few ties in
--           draw order. This is the default, and a tournament nobody curates
--           still gets a sensible block.
--   '{}'  → suppressed. The admin deliberately wants no "up next" block on this
--           tournament's email.
--   ids   → exactly these ties, filtered to the ones still pending at send time.
--
-- Ids are draw `matchId` strings, NOT match_results ids: an unplayed tie has no
-- result row by definition. They are the same strings that key
-- `predictions.picks`, which is what makes the crowd line ("62% of brackets
-- have Sinner") derivable for a match that has not happened yet.
--
-- Not foreign-keyed and not validated, on purpose. A draw re-save can renumber
-- or remove a tie (a qualifier resolves, a withdrawal reshuffles a section),
-- which would leave a constraint pointing at nothing and block the re-save —
-- the one operation this project has already broken two invariants on. The
-- reader filters instead: ids that are not pending at send time are dropped,
-- and a selection that survives none of them falls back to auto rather than
-- sending an empty block.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS email_upcoming_match_ids text[];

COMMENT ON COLUMN public.tournaments.email_upcoming_match_ids IS
  'Draw matchIds featured as "up next" in the points-awarded email. NULL = auto (first few of the earliest pending round); empty array = no block; otherwise exactly these, filtered to those still pending.';
