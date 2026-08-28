-- Migration: 094_unlock_prediction
-- Description: Give a locked bracket a way back. "Lock all picks" was final and
--              irreversible, which cost us new users who read the button as
--              "submit".
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHY THIS IS A FUNCTION AND NOT A LOOSENED RLS POLICY
--
-- The obvious change is to relax the UPDATE policy from 017:
--
--   USING (auth.uid() = user_id AND is_fully_locked = false)
--
-- Dropping the second clause would let the owner update a locked row — and
-- would also let them rewrite the PICKS on a locked bracket, which is the one
-- thing the lock exists to prevent. The policy is not in the way of unlocking;
-- it is the guarantee that a locked bracket is frozen, and it should keep
-- being exactly that.
--
-- So the unlock is the single exception, written as a SECURITY DEFINER
-- function that performs one specific state transition and nothing else. The
-- row it touches is resolved from auth.uid(), not from an argument, so there
-- is no id for a caller to swap. RLS stays strict; the escape hatch is narrow,
-- auditable, and enforced in the database rather than in a server action that
-- a future caller might forget to reproduce.
--
-- WHAT UNLOCKING COSTS THE USER
--
-- Locking is what buys the streak multiplier (PR #163): a pick only earns it
-- if it was committed BEFORE its match was decided. Unlocking therefore
-- withdraws that commitment — but only on matches that have not been played.
-- Locks on already-decided matches are kept, because that commitment was real
-- and was made in time; the user could not change those picks anyway, since
-- savePrediction refuses to touch a played match.
--
-- The effect is that unlocking cannot be used to game the multiplier. You give
-- back exactly the commitments you have not yet cashed, and re-locking later
-- re-earns them at the later timestamp.
-- ============================================================


-- ── Audit columns ────────────────────────────────────────────────────────────
-- unlocked_at doubles as a signal to the auto-predict cron: a bracket the user
-- has taken manual control of must never be refilled or re-locked underneath
-- them. Without it the cron's next run (triggered by any draw re-sync, which a
-- slam gets on every withdrawal) would replace their picks wholesale and lock
-- the bracket again, silently undoing the unlock.
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS unlocked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unlock_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.predictions.unlocked_at IS
  'When the owner last reopened this bracket after a full lock. Non-null also tells the auto-predict cron to leave the bracket alone.';
COMMENT ON COLUMN public.predictions.unlock_count IS
  'How many times this bracket has been reopened. Analytics only — unlocking is not rationed.';


-- ── Unlock one of my own brackets ────────────────────────────────────────────
-- Returns a JSONB result rather than raising, so the server action can map each
-- refusal to its own message instead of parsing an error string.
--
--   { ok: true,  already_unlocked: bool, withdrawn: int, kept: int }
--   { ok: false, error: 'not_authenticated' | 'not_found'
--                     | 'tournament_closed' | 'opponent_locked' }
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

  -- Ownership is the WHERE clause, not a check: a bracket that is not yours is
  -- indistinguishable from one that does not exist.
  SELECT * INTO v_pred
  FROM public.predictions
  WHERE id = p_prediction_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Idempotent. Two tabs, or a double click, must not spend an unlock twice or
  -- report a failure for a bracket that is already open.
  IF v_pred.is_fully_locked IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', true, 'already_unlocked', true, 'withdrawn', 0, 'kept', 0);
  END IF;

  -- Unlock is available exactly as long as picking is: there is no point
  -- reopening a bracket that savePrediction would then refuse to save.
  -- The prediction-mode toggle narrows this further for global brackets and is
  -- applied in the server action, which already owns that cached helper.
  SELECT status INTO v_status FROM public.tournaments WHERE id = v_pred.tournament_id;
  IF v_status NOT IN ('accepting_predictions', 'in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_closed', 'status', v_status);
  END IF;

  -- The poker rule. A friends challenge reveals both brackets once both sides
  -- have locked, so unlocking after that would mean changing your picks with
  -- your opponent's picks in front of you. Before they lock you have seen
  -- nothing, so there is nothing to protect.
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

  -- Keep only the commitments that were already cashed — see the header note.
  -- pick_locks is keyed by external match id, the same key match_results uses.
  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    INTO v_kept_locks
  FROM jsonb_each(COALESCE(v_pred.pick_locks, '{}'::jsonb)) AS e
  WHERE EXISTS (
    SELECT 1 FROM public.match_results mr
    WHERE mr.tournament_id   = v_pred.tournament_id
      AND mr.external_match_id = e.key
  );

  SELECT COUNT(*) INTO v_before FROM jsonb_object_keys(COALESCE(v_pred.pick_locks, '{}'::jsonb));
  SELECT COUNT(*) INTO v_kept   FROM jsonb_object_keys(v_kept_locks);

  UPDATE public.predictions
     SET is_fully_locked = false,
         fully_locked_at = NULL,
         pick_locks      = v_kept_locks,
         unlocked_at     = NOW(),
         unlock_count    = COALESCE(unlock_count, 0) + 1,
         updated_at      = NOW()
   WHERE id = p_prediction_id AND user_id = v_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_unlocked', false,
    'withdrawn', v_before - v_kept,
    'kept', v_kept
  );
END;
$$;

COMMENT ON FUNCTION public.unlock_prediction(UUID) IS
  'Reopen one of your own fully-locked brackets while the tournament is still predictable. Withdraws streak commitments on undecided matches; keeps them on played ones.';

-- The argument is a prediction id, but the row is scoped to auth.uid() inside
-- the function, so a signed-in caller passing someone else's id gets
-- not_found. Safe to expose directly to `authenticated`.
REVOKE EXECUTE ON FUNCTION public.unlock_prediction(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unlock_prediction(UUID) TO authenticated, service_role;
