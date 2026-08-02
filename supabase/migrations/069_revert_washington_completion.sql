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
-- The same logic lives in the admin UI (revertTournamentCompletion) as the
-- "Un-complete Tournament" button on the results page.
--
-- ── Why this is one DO block ─────────────────────────────────────────────────
-- The first version of this file used CREATE TEMP TABLE ... ON COMMIT DROP to
-- carry the target id and the badge snapshot between statements, the way
-- 051_revert_miami.sql does. The Supabase SQL editor does not keep one
-- transaction across the whole script, so the temp tables were dropped partway
-- through and the final verification block failed with
-- `42P01: relation "_target" does not exist`.
--
-- Everything is therefore a single statement here: local variables instead of
-- temp tables, and the notification delete joins user_achievements directly
-- rather than a snapshot of it (hence: notifications BEFORE badges).
--
-- Re-running this is safe. Once the revert is applied every step matches zero
-- rows and the block just re-verifies. Do NOT run it after the final has
-- genuinely been played and the tournament legitimately completed — it would
-- strip the real trophies.

DO $$
DECLARE
  _tid                uuid;
  _matches            INT;
  _status             text;
  _badges             INT;
  _notifications      INT;
  _challenges         INT;
  _invites            INT;
  _achievements_left  INT;
  _challenges_left    INT;
BEGIN
  -- 1. Resolve the tournament. Fail loudly rather than silently touching zero
  --    rows (or, worse, two tournaments) if this does not match exactly one.
  SELECT COUNT(*) INTO _matches
  FROM public.tournaments
  WHERE name = 'Mubadala Citi DC Open'
    AND EXTRACT(YEAR FROM starts_at) = 2026;

  IF _matches <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 Washington 2026 tournament, found %', _matches;
  END IF;

  SELECT id, status INTO _tid, _status
  FROM public.tournaments
  WHERE name = 'Mubadala Citi DC Open'
    AND EXTRACT(YEAR FROM starts_at) = 2026;

  RAISE NOTICE 'Target % — current status %', _tid, _status;

  -- 2. Flip the status back FIRST. Order matters: a cron run landing mid-repair
  --    would re-award every trophy deleted below. Removing the trigger before
  --    the consequences means the worst case is a half-cleaned state that this
  --    block can safely be re-run over, never a silently re-awarded badge.
  UPDATE public.tournaments
  SET status = 'in_progress'
  WHERE id = _tid
    AND status = 'completed';

  -- 3. Delete the badge notifications BEFORE the badges themselves — the
  --    achievement rows are what identifies them. notifyAchievements writes no
  --    tournament_id, only meta.achievement_key, so a ±10 minute window around
  --    earned_at is what separates this award from the same repeatable trophy
  --    won at another event. The window is far wider than the insert lag and far
  --    narrower than the gap between two tournaments completing.
  WITH removed AS (
    DELETE FROM public.notifications n
    USING public.user_achievements ua
    WHERE ua.tournament_id = _tid
      AND n.user_id = ua.user_id
      AND n.type    = 'achievement_earned'
      AND n.meta->>'achievement_key' = ua.achievement_key
      AND n.created_at BETWEEN ua.earned_at - INTERVAL '10 minutes'
                           AND ua.earned_at + INTERVAL '10 minutes'
    RETURNING n.id
  )
  SELECT COUNT(*) INTO _notifications FROM removed;

  -- 4. Remove the tournament-scoped badges: trophies (champion / runner-up /
  --    podium) and Perfect Prediction all carry tournament_id. Global milestones
  --    (tournament_id IS NULL) are one-way and deliberately untouched.
  WITH removed AS (
    DELETE FROM public.user_achievements
    WHERE tournament_id = _tid
    RETURNING id
  )
  SELECT COUNT(*) INTO _badges FROM removed;

  -- 5. Reopen the challenges the completion finalized. Points stay — they are
  --    recomputed from the untouched predictions on every cron run and are
  --    correct as of now. Only the verdict is withdrawn.
  WITH reopened AS (
    UPDATE public.challenges
    SET status = CASE WHEN is_anonymous THEN 'active' ELSE 'accepted' END,
        winner_id  = CASE WHEN is_anonymous THEN winner_id ELSE NULL END,
        updated_at = now()
    WHERE tournament_id = _tid
      AND status = 'completed'
    RETURNING id
  )
  SELECT COUNT(*) INTO _challenges FROM reopened;

  -- 6. Un-expire the invites the completion killed. Both code paths that write
  --    'expired' fire only because the tournament was completed, so for this
  --    tournament every expired row is collateral from the mistake.
  WITH restored AS (
    UPDATE public.challenges
    SET status = 'pending', updated_at = now()
    WHERE tournament_id = _tid
      AND status = 'expired'
    RETURNING id
  )
  SELECT COUNT(*) INTO _invites FROM restored;

  -- 7. Verify. Any leftover means the revert is incomplete — abort.
  SELECT status INTO _status FROM public.tournaments WHERE id = _tid;

  SELECT COUNT(*) INTO _achievements_left
  FROM public.user_achievements WHERE tournament_id = _tid;

  SELECT COUNT(*) INTO _challenges_left
  FROM public.challenges
  WHERE tournament_id = _tid AND status IN ('completed', 'expired');

  IF _status <> 'in_progress' THEN
    RAISE EXCEPTION 'Washington revert failed: status is % (expected in_progress)', _status;
  END IF;
  IF _achievements_left + _challenges_left > 0 THEN
    RAISE EXCEPTION 'Washington revert incomplete: achievements=%, challenges=%',
      _achievements_left, _challenges_left;
  END IF;

  RAISE NOTICE 'Washington revert verified — status in_progress, % badge(s), % notification(s) removed, % challenge(s) reopened, % invite(s) restored (all zero on a re-run).',
    _badges, _notifications, _challenges, _invites;
END $$;
