-- Migration: 095_unlock_picks
-- Description: The other half of 094. Unlocking a whole bracket had a way back;
--              committing a single pick or a single round still did not.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHY 094 WAS NOT ENOUGH
--
-- 094 reverses `is_fully_locked` — "Lock all picks". But this app calls four
-- different things "lock", and the one people actually reach for is the round
-- lock: it is the safe button, it forfeits nothing, and the bracket's own copy
-- recommends it. Committing a round wrote `pick_locks[matchId] = 'round'` with
-- no way to undo it, so the recommended path was the one with no exit.
--
-- The unlock button from 094 only renders on a fully-locked bracket, which
-- means a bracket in exactly this state — round locks, no bracket lock — fell
-- in the gap: the state that needed undoing existed, the door to it did not.
--
-- WHAT THIS DOES NOT TOUCH
--
-- Only locks on matches that have NOT been played. Two different reasons, and
-- both matter:
--
--   * A pick on a played match cannot be changed anyway — savePrediction
--     rejects it — so releasing the lock would be theatre.
--   * `pick_locks[matchId] = 'auto'` is stamped by the award-points cron AFTER
--     a match is decided. It is a record, not a commitment. Deleting those
--     would rewrite scoring history.
--
-- Same trade as 094: releasing a live commitment gives back the streak
-- multiplier on that pick until it is committed again.
-- ============================================================


-- ── Release commitments on specific matches ──────────────────────────────────
-- Returns:
--   { ok: true,  released: int, kept: int }
--   { ok: false, error: 'not_authenticated' | 'not_found'
--                     | 'tournament_closed' | 'bracket_fully_locked' }
--
-- `bracket_fully_locked` is a redirect, not a refusal: the bracket lock
-- outranks every per-pick lock, so unlock_prediction() is the call to make.
-- Releasing individual picks underneath a locked bracket would change nothing a
-- user could see and would quietly strip commitments they still hold.
CREATE OR REPLACE FUNCTION public.unlock_picks(p_prediction_id UUID, p_match_ids TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_pred     public.predictions%ROWTYPE;
  v_status   TEXT;
  v_new      JSONB;
  v_before   INTEGER;
  v_after    INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_pred
  FROM public.predictions
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

  -- Keep every lock EXCEPT the requested ones that are still undecided. An id
  -- the caller sends that is already played, or was never locked, is simply not
  -- matched — the request degrades instead of failing.
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
     SET pick_locks = v_new,
         updated_at = NOW()
   WHERE id = p_prediction_id AND user_id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'released', v_before - v_after, 'kept', v_after);
END;
$$;

COMMENT ON FUNCTION public.unlock_picks(UUID, TEXT[]) IS
  'Release streak commitments on specific unplayed matches of your own bracket. Companion to unlock_prediction(), which handles the whole-bracket lock.';

REVOKE EXECUTE ON FUNCTION public.unlock_picks(UUID, TEXT[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unlock_picks(UUID, TEXT[]) TO authenticated, service_role;
