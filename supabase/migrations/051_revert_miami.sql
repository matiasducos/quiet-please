-- 051_revert_miami.sql
-- Revert all user-generated data for the Miami Open (id: cfb27bd4-e32f-4624-8d2c-160afd9a9230).
-- Miami was played during development; this migration makes it as if no one predicted it.
-- Keeps: the tournament row itself, its draws, and match_results (real results stay).
-- Removes: predictions, point_ledger, challenges (friends + anonymous), notifications, achievements.
-- Recalculates: users.ranking_points and league_members.total_points for affected users only (targeted, scalable).

BEGIN;

-- 1. Capture affected users BEFORE deleting anything.
--    Only users with global predictions (challenge_id IS NULL) can have ranking_points affected.
CREATE TEMP TABLE _affected_users ON COMMIT DROP AS
SELECT DISTINCT user_id
FROM public.predictions
WHERE tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230'
  AND challenge_id IS NULL
  AND user_id IS NOT NULL;

-- 2. Capture (league_id, user_id) pairs for targeted league recalc.
--    Per project convention: NEVER call the global recalculate_league_points() for this.
CREATE TEMP TABLE _affected_league_members ON COMMIT DROP AS
SELECT DISTINCT lm.league_id, lm.user_id
FROM public.league_members lm
JOIN _affected_users u ON u.user_id = lm.user_id;

-- 3. Delete Miami-scoped rows. Order matters only for clarity — FK cascades would handle it.
DELETE FROM public.user_achievements
WHERE tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230';

DELETE FROM public.notifications
WHERE tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230';

DELETE FROM public.point_ledger
WHERE tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230';

-- Deletes both global predictions AND challenge-linked predictions in one pass.
DELETE FROM public.predictions
WHERE tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230';

-- Deletes both friends challenges and anonymous challenges tied to Miami.
DELETE FROM public.challenges
WHERE tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230';

-- 4. Recalculate ranking_points for every affected user.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT user_id FROM _affected_users LOOP
    PERFORM public.recalculate_ranking_points(r.user_id);
  END LOOP;
END $$;

-- 5. Recalculate league_members.total_points — targeted, one call per affected pair.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT league_id, user_id FROM _affected_league_members LOOP
    PERFORM public.recalculate_member_points(r.league_id, r.user_id);
  END LOOP;
END $$;

-- 6. Verification — all four counts must be 0. Fails the transaction if any row remains.
DO $$
DECLARE
  _predictions_left  INT;
  _ledger_left       INT;
  _challenges_left   INT;
  _notifications_left INT;
  _achievements_left INT;
BEGIN
  SELECT COUNT(*) INTO _predictions_left  FROM public.predictions      WHERE tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230';
  SELECT COUNT(*) INTO _ledger_left       FROM public.point_ledger     WHERE tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230';
  SELECT COUNT(*) INTO _challenges_left   FROM public.challenges       WHERE tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230';
  SELECT COUNT(*) INTO _notifications_left FROM public.notifications   WHERE tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230';
  SELECT COUNT(*) INTO _achievements_left FROM public.user_achievements WHERE tournament_id = 'cfb27bd4-e32f-4624-8d2c-160afd9a9230';

  IF _predictions_left + _ledger_left + _challenges_left + _notifications_left + _achievements_left > 0 THEN
    RAISE EXCEPTION 'Miami revert incomplete: predictions=%, ledger=%, challenges=%, notifications=%, achievements=%',
      _predictions_left, _ledger_left, _challenges_left, _notifications_left, _achievements_left;
  END IF;

  RAISE NOTICE 'Miami revert verified: all user-generated rows removed.';
END $$;

COMMIT;
