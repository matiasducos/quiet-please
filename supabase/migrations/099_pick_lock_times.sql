-- Migration: 099_pick_lock_times
-- Description: Record WHEN each pick was committed, so the streak multiplier can
--              require that the commitment predates the feeder's result — i.e.
--              that the pick was stacked on a prediction, not on a known winner.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHAT THIS IS FOR
--
-- The multiplier rewards a run of correct calls on the same player. Until now
-- the run counted regardless of WHEN each call was made, so the cheapest way to
-- a high multiplier was to wait for each round to resolve and re-pick the
-- winner who had just advanced. That is not a prediction, and it out-scored the
-- person who called the whole run in advance.
--
-- The new rule: a link in the chain counts only if the pick was COMMITTED
-- before the feeder match was decided. Locking is already what buys the
-- multiplier (see COMMITTED_LOCK_TYPES), so this only adds the missing half —
-- the time it happened.
--
-- pick_locks records HOW a pick was committed ('voluntary' | 'round' |
-- 'auto_lock_all', and the cron's post-match 'auto'). This records WHEN, keyed
-- the same way. Two maps rather than one object per match, because changing the
-- shape of pick_locks would break committedPicks() and every caller of it.
--
-- FIRST WRITE WINS, exactly as pick_locks already does. A later lock must not
-- rewrite an earlier one, or a commitment gets back-dated — which under this
-- rule is worth points.
--
-- WHY THE UNLOCK FUNCTIONS HAVE TO CHANGE TOO
--
-- 094, 095 and 096 all rewrite pick_locks, dropping commitments on matches that
-- have not been played. If pick_lock_times kept its entries, re-locking would
-- find a stale timestamp already present, first-write-wins would preserve it,
-- and the user would hold a commitment dated before a result they have now
-- seen. The two maps must be pruned together, always.
-- ============================================================

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS pick_lock_times JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.predictions.pick_lock_times IS
  'matchId -> ISO timestamp of when that pick was committed. Paired with pick_locks (which records how). Written first-write-wins; pruned in lockstep by the unlock functions. Used by calculateStreakMultiplier to require a commitment predating the feeder result.';


-- ── 094 revisited: prune times alongside locks ───────────────────────────────
CREATE OR REPLACE FUNCTION public.unlock_prediction(p_prediction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id         UUID := auth.uid();
  v_pred            public.predictions%ROWTYPE;
  v_status          TEXT;
  v_opponent_locked BOOLEAN;
  v_kept_locks      JSONB;
  v_before          INTEGER;
  v_kept            INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_pred FROM public.predictions
  WHERE id = p_prediction_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_pred.is_fully_locked IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', true, 'already_unlocked', true, 'withdrawn', 0, 'kept', 0);
  END IF;

  SELECT status INTO v_status FROM public.tournaments WHERE id = v_pred.tournament_id;
  IF v_status NOT IN ('accepting_predictions', 'in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_closed', 'status', v_status);
  END IF;

  IF v_pred.challenge_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.predictions p
      WHERE p.challenge_id = v_pred.challenge_id
        AND p.user_id <> v_user_id
        AND p.is_fully_locked
    ) INTO v_opponent_locked;
    IF v_opponent_locked THEN
      RETURN jsonb_build_object('ok', false, 'error', 'opponent_locked');
    END IF;
  END IF;

  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    INTO v_kept_locks
  FROM jsonb_each(COALESCE(v_pred.pick_locks, '{}'::jsonb)) AS e
  WHERE EXISTS (
    SELECT 1 FROM public.match_results mr
    WHERE mr.tournament_id     = v_pred.tournament_id
      AND mr.external_match_id = e.key
  );

  SELECT COUNT(*) INTO v_before FROM jsonb_object_keys(COALESCE(v_pred.pick_locks, '{}'::jsonb));
  SELECT COUNT(*) INTO v_kept   FROM jsonb_object_keys(v_kept_locks);

  UPDATE public.predictions
     SET is_fully_locked = false,
         fully_locked_at = NULL,
         pick_locks      = v_kept_locks,
         -- Pruned to exactly the keys that survived above.
         pick_lock_times = (
           SELECT COALESCE(jsonb_object_agg(t.key, t.value), '{}'::jsonb)
           FROM jsonb_each(COALESCE(pick_lock_times, '{}'::jsonb)) AS t
           WHERE v_kept_locks ? t.key
         ),
         unlocked_at     = NOW(),
         unlock_count    = COALESCE(unlock_count, 0) + 1,
         updated_at      = NOW()
   WHERE id = p_prediction_id AND user_id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'already_unlocked', false,
                            'withdrawn', v_before - v_kept, 'kept', v_kept);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unlock_prediction(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unlock_prediction(UUID) TO authenticated, service_role;


-- ── 095 revisited ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unlock_picks(p_prediction_id UUID, p_match_ids TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_pred    public.predictions%ROWTYPE;
  v_status  TEXT;
  v_new     JSONB;
  v_before  INTEGER;
  v_after   INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_pred FROM public.predictions
  WHERE id = p_prediction_id AND user_id = v_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_pred.is_fully_locked IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bracket_fully_locked');
  END IF;

  SELECT status INTO v_status FROM public.tournaments WHERE id = v_pred.tournament_id;
  IF v_status NOT IN ('accepting_predictions', 'in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_closed', 'status', v_status);
  END IF;

  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    INTO v_new
  FROM jsonb_each(COALESCE(v_pred.pick_locks, '{}'::jsonb)) AS e
  WHERE NOT (
    e.key = ANY(COALESCE(p_match_ids, ARRAY[]::TEXT[]))
    AND NOT EXISTS (
      SELECT 1 FROM public.match_results mr
      WHERE mr.tournament_id     = v_pred.tournament_id
        AND mr.external_match_id = e.key
    )
  );

  SELECT COUNT(*) INTO v_before FROM jsonb_object_keys(COALESCE(v_pred.pick_locks, '{}'::jsonb));
  SELECT COUNT(*) INTO v_after  FROM jsonb_object_keys(v_new);

  UPDATE public.predictions
     SET pick_locks      = v_new,
         pick_lock_times = (
           SELECT COALESCE(jsonb_object_agg(t.key, t.value), '{}'::jsonb)
           FROM jsonb_each(COALESCE(pick_lock_times, '{}'::jsonb)) AS t
           WHERE v_new ? t.key
         ),
         updated_at = NOW()
   WHERE id = p_prediction_id AND user_id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'released', v_before - v_after, 'kept', v_after);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unlock_picks(UUID, TEXT[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unlock_picks(UUID, TEXT[]) TO authenticated, service_role;


-- ── 096 revisited ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_unlock_prediction(
  p_prediction_id            UUID,
  p_allow_revealed_challenge BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pred            public.predictions%ROWTYPE;
  v_status          TEXT;
  v_opponent_locked BOOLEAN;
  v_kept_locks      JSONB;
  v_before          INTEGER;
  v_kept            INTEGER;
  v_was_locked      BOOLEAN;
BEGIN
  SELECT * INTO v_pred FROM public.predictions WHERE id = p_prediction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT status INTO v_status FROM public.tournaments WHERE id = v_pred.tournament_id;
  IF v_status NOT IN ('accepting_predictions', 'in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_closed', 'status', v_status);
  END IF;

  IF v_pred.challenge_id IS NOT NULL AND NOT p_allow_revealed_challenge THEN
    SELECT EXISTS (
      SELECT 1 FROM public.predictions p
      WHERE p.challenge_id = v_pred.challenge_id
        AND p.user_id     <> v_pred.user_id
        AND p.is_fully_locked
    ) INTO v_opponent_locked;
    IF v_opponent_locked THEN
      RETURN jsonb_build_object('ok', false, 'error', 'opponent_locked');
    END IF;
  END IF;

  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    INTO v_kept_locks
  FROM jsonb_each(COALESCE(v_pred.pick_locks, '{}'::jsonb)) AS e
  WHERE EXISTS (
    SELECT 1 FROM public.match_results mr
    WHERE mr.tournament_id     = v_pred.tournament_id
      AND mr.external_match_id = e.key
  );

  SELECT COUNT(*) INTO v_before FROM jsonb_object_keys(COALESCE(v_pred.pick_locks, '{}'::jsonb));
  SELECT COUNT(*) INTO v_kept   FROM jsonb_object_keys(v_kept_locks);
  v_was_locked := COALESCE(v_pred.is_fully_locked, FALSE);

  IF NOT v_was_locked AND v_before = v_kept THEN
    RETURN jsonb_build_object(
      'ok', true, 'no_op', true, 'was_fully_locked', false,
      'withdrawn', 0, 'kept', v_kept,
      'user_id', v_pred.user_id, 'tournament_id', v_pred.tournament_id,
      'challenge_id', v_pred.challenge_id);
  END IF;

  UPDATE public.predictions
     SET is_fully_locked = false,
         fully_locked_at = NULL,
         pick_locks      = v_kept_locks,
         pick_lock_times = (
           SELECT COALESCE(jsonb_object_agg(t.key, t.value), '{}'::jsonb)
           FROM jsonb_each(COALESCE(pick_lock_times, '{}'::jsonb)) AS t
           WHERE v_kept_locks ? t.key
         ),
         unlocked_at     = NOW(),
         unlock_count    = COALESCE(unlock_count, 0) + 1,
         updated_at      = NOW()
   WHERE id = p_prediction_id;

  RETURN jsonb_build_object(
    'ok', true, 'no_op', false, 'was_fully_locked', v_was_locked,
    'withdrawn', v_before - v_kept, 'kept', v_kept,
    'user_id', v_pred.user_id, 'tournament_id', v_pred.tournament_id,
    'challenge_id', v_pred.challenge_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_unlock_prediction(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_unlock_prediction(UUID, BOOLEAN) TO service_role;
