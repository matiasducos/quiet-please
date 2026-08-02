-- 069_revert_washington_completion.sql
-- Washington 2026 (Mubadala Citi DC Open) was marked completed by mistake before
-- the final was played. In this codebase `completed` is a trigger, not a label:
-- the award-points cron reads it as the finish line and, in the same run,
-- awards trophies + Perfect Prediction, finalizes friends and anonymous
-- challenges, and expires every still-pending challenge invite.
--
-- This undoes those consequences and puts the tournament back to in_progress.
--
-- KEPT on purpose: point_ledger, predictions.points_earned, users.ranking_points,
-- league_members.total_points. Those matches really were played and their points
-- are correct — no recalculation is needed or wanted here.
--
-- Silent: the achievement notifications are deleted alongside the badges, so a
-- user who has not opened the app since sees nothing at all. Badge emails that
-- already went out cannot be recalled.
--
-- The same logic now lives in the admin UI (revertTournamentCompletion) as the
-- "Un-complete Tournament" button on the results page.

BEGIN;

-- 1. Resolve the tournament. Fail loudly rather than silently touching zero rows
--    (or, worse, two tournaments) if the name/year does not match exactly one.
DO $$
DECLARE
  _matches INT;
BEGIN
  SELECT COUNT(*) INTO _matches
  FROM public.tournaments
  WHERE name = 'Mubadala Citi DC Open'
    AND EXTRACT(YEAR FROM starts_at) = 2026
    AND status = 'completed';

  IF _matches <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 completed Washington 2026 tournament, found %', _matches;
  END IF;
END $$;

CREATE TEMP TABLE _target ON COMMIT DROP AS
SELECT id
FROM public.tournaments
WHERE name = 'Mubadala Citi DC Open'
  AND EXTRACT(YEAR FROM starts_at) = 2026
  AND status = 'completed';

-- 2. Snapshot the badges BEFORE deleting them — their (user, key, earned_at) is
--    the only handle on the notifications they generated. notifyAchievements
--    writes no tournament_id, only meta.achievement_key.
CREATE TEMP TABLE _removed_achievements ON COMMIT DROP AS
SELECT ua.user_id, ua.achievement_key, ua.earned_at
FROM public.user_achievements ua
JOIN _target t ON t.id = ua.tournament_id;

-- 3. Flip the status back FIRST. Order matters: a cron run landing mid-migration
--    would re-award every trophy deleted below. (Inside a transaction this is
--    belt-and-braces, but it keeps the migration and the app action identical.)
UPDATE public.tournaments
SET status = 'in_progress'
WHERE id IN (SELECT id FROM _target)
  AND status = 'completed';

-- 4. Remove the tournament-scoped badges: trophies (champion / runner-up /
--    podium) and Perfect Prediction all carry tournament_id. Global milestones
--    (tournament_id IS NULL) are one-way and deliberately untouched.
DELETE FROM public.user_achievements ua
USING _target t
WHERE ua.tournament_id = t.id;

-- 5. Remove the badge notifications those awards produced. A ±10 minute window
--    around earned_at separates this award from the same repeatable trophy won
--    at a different event, and is far wider than the notification insert lag.
DELETE FROM public.notifications n
USING _removed_achievements ra
WHERE n.user_id = ra.user_id
  AND n.type    = 'achievement_earned'
  AND n.meta->>'achievement_key' = ra.achievement_key
  AND n.created_at BETWEEN ra.earned_at - INTERVAL '10 minutes'
                       AND ra.earned_at + INTERVAL '10 minutes';

-- 6. Reopen the challenges the completion finalized. Points stay — they are
--    recomputed from the untouched predictions on every cron run and are correct
--    as of now. Only the verdict is withdrawn.
UPDATE public.challenges c
SET status = 'accepted', winner_id = NULL, updated_at = now()
FROM _target t
WHERE c.tournament_id = t.id
  AND c.status        = 'completed'
  AND c.is_anonymous  = false;

UPDATE public.challenges c
SET status = 'active', updated_at = now()
FROM _target t
WHERE c.tournament_id = t.id
  AND c.status        = 'completed'
  AND c.is_anonymous  = true;

-- 7. Un-expire the invites the completion killed. Both code paths that write
--    'expired' fire only because the tournament was completed, so for this
--    tournament every expired row is collateral from the mistake.
UPDATE public.challenges c
SET status = 'pending', updated_at = now()
FROM _target t
WHERE c.tournament_id = t.id
  AND c.status        = 'expired';

-- 8. Verify. Any leftover means the revert is incomplete — fail the transaction.
DO $$
DECLARE
  _tid                uuid;
  _status             text;
  _achievements_left  INT;
  _notifications_left INT;
  _challenges_left    INT;
BEGIN
  SELECT id INTO _tid FROM _target;
  SELECT status INTO _status FROM public.tournaments WHERE id = _tid;

  SELECT COUNT(*) INTO _achievements_left
  FROM public.user_achievements WHERE tournament_id = _tid;

  SELECT COUNT(*) INTO _notifications_left
  FROM public.notifications n
  JOIN _removed_achievements ra
    ON ra.user_id = n.user_id
   AND ra.achievement_key = n.meta->>'achievement_key'
  WHERE n.type = 'achievement_earned'
    AND n.created_at BETWEEN ra.earned_at - INTERVAL '10 minutes'
                         AND ra.earned_at + INTERVAL '10 minutes';

  SELECT COUNT(*) INTO _challenges_left
  FROM public.challenges
  WHERE tournament_id = _tid AND status IN ('completed', 'expired');

  IF _status <> 'in_progress' THEN
    RAISE EXCEPTION 'Washington revert failed: status is % (expected in_progress)', _status;
  END IF;
  IF _achievements_left + _notifications_left + _challenges_left > 0 THEN
    RAISE EXCEPTION 'Washington revert incomplete: achievements=%, notifications=%, challenges=%',
      _achievements_left, _notifications_left, _challenges_left;
  END IF;

  RAISE NOTICE 'Washington revert verified: % badge(s) removed, tournament back to in_progress.',
    (SELECT COUNT(*) FROM _removed_achievements);
END $$;

COMMIT;
