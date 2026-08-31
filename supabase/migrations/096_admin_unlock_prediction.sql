-- Migration: 096_admin_unlock_prediction
-- Description: Let an admin reopen ANY user's bracket from /admin/predictions.
--              094 and 095 gave the owner a way back; a user who cannot find
--              those buttons, or whose bracket sits in a state they refuse,
--              still had to be fixed by hand in the SQL editor.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHY THIS IS NOT unlock_prediction() WITH AN EXTRA ARGUMENT
--
-- 094 and 095 both resolve the row with
--
--   WHERE id = p_prediction_id AND user_id = auth.uid()
--
-- That clause is the whole security model: the id is an argument, so it is
-- attacker-controlled, and scoping to auth.uid() is what makes passing
-- somebody else's id indistinguishable from passing a nonexistent one. Adding
-- an "act as admin" branch inside those functions would put a hole in the
-- exact line that closes it, on a function granted to `authenticated`.
--
-- So the privileged variant is a separate function with a separate grant:
-- service_role only, reachable solely through createAdminClient() behind
-- assertAdmin(). The authenticated role never gets EXECUTE, so there is no
-- request a signed-in user can craft that reaches it at all.
--
-- WHY IT DOES BOTH HALVES OF THE UNLOCK
--
-- 094 reverses the bracket lock; 095 reverses per-pick and per-round locks.
-- From the panel, "unlock this bracket" has to mean one thing — the bracket
-- ends up editable — so this does both in one transition. It matters: a
-- bracket with round locks and no bracket lock is a real and common state
-- (the round lock is the button the UI recommends), and a straight port of
-- 094 would report "already unlocked" and change nothing.
--
-- WHAT IT STILL WILL NOT DO
--
-- Locks on PLAYED matches are kept, exactly as in 094/095. Two reasons, both
-- unchanged by the caller being an admin:
--   * savePrediction refuses to touch a played match anyway, so releasing
--     those locks would change nothing a user could see.
--   * pick_locks[matchId] = 'auto' is stamped by the award-points cron after
--     a match is decided. It is a record of scoring, not a commitment, and
--     deleting it would rewrite history.
-- ============================================================


-- ── Audit vocabulary ─────────────────────────────────────────────────────────
-- admin_actions (071) was written with single-value CHECKs, so recording a
-- second kind of action means widening them rather than working around them in
-- app code. Names are the ones Postgres generated for the inline constraints.
ALTER TABLE public.admin_actions DROP CONSTRAINT IF EXISTS admin_actions_action_check;
ALTER TABLE public.admin_actions
  ADD CONSTRAINT admin_actions_action_check
  CHECK (action IN ('user.delete', 'prediction.unlock'));

ALTER TABLE public.admin_actions DROP CONSTRAINT IF EXISTS admin_actions_target_type_check;
ALTER TABLE public.admin_actions
  ADD CONSTRAINT admin_actions_target_type_check
  CHECK (target_type IN ('user', 'prediction'));


-- ── Unlock any bracket, as an admin ──────────────────────────────────────────
-- Returns a JSONB result rather than raising, so the server action can map each
-- refusal to its own message instead of parsing an error string.
--
--   { ok: true,  no_op: bool, was_fully_locked: bool, withdrawn: int, kept: int,
--     user_id: uuid, tournament_id: uuid, challenge_id: uuid|null }
--   { ok: false, error: 'not_found' | 'tournament_closed' | 'opponent_locked' }
CREATE OR REPLACE FUNCTION public.admin_unlock_prediction(
  p_prediction_id             UUID,
  p_allow_revealed_challenge  BOOLEAN DEFAULT FALSE
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

  -- Same window as picking, and NOT overridable. Outside it savePrediction
  -- rejects every match anyway, so an unlock would hand the user an editable
  -- bracket they cannot edit — while clearing commitments that scoring has
  -- already paid out against.
  SELECT status INTO v_status FROM public.tournaments WHERE id = v_pred.tournament_id;
  IF v_status NOT IN ('accepting_predictions', 'in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_closed', 'status', v_status);
  END IF;

  -- The poker rule from 094. A friends challenge reveals both brackets once
  -- both sides have locked, so unlocking after that means picking with the
  -- opponent's bracket visible. An admin CAN override this one — fixing a
  -- genuine mistake is why the panel exists — but only by asking for it
  -- explicitly, and the override is recorded in admin_actions.
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

  -- Keep only the commitments already cashed — see the header note.
  -- pick_locks is keyed by external match id, the same key match_results uses.
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

  -- Nothing locked and nothing to release. Reported rather than written, so a
  -- double click cannot inflate unlock_count or move unlocked_at.
  IF NOT v_was_locked AND v_before = v_kept THEN
    RETURN jsonb_build_object(
      'ok', true, 'no_op', true, 'was_fully_locked', false,
      'withdrawn', 0, 'kept', v_kept,
      'user_id', v_pred.user_id, 'tournament_id', v_pred.tournament_id,
      'challenge_id', v_pred.challenge_id
    );
  END IF;

  -- unlocked_at is not bookkeeping: the auto-predict cron reads it as "this
  -- bracket is under manual control". Without it the next run — which any draw
  -- re-sync triggers, and a slam re-syncs on every withdrawal — would refill
  -- the picks and re-lock the bracket, silently undoing this.
  UPDATE public.predictions
     SET is_fully_locked = false,
         fully_locked_at = NULL,
         pick_locks      = v_kept_locks,
         unlocked_at     = NOW(),
         unlock_count    = COALESCE(unlock_count, 0) + 1,
         updated_at      = NOW()
   WHERE id = p_prediction_id;

  RETURN jsonb_build_object(
    'ok', true,
    'no_op', false,
    'was_fully_locked', v_was_locked,
    'withdrawn', v_before - v_kept,
    'kept', v_kept,
    'user_id', v_pred.user_id,
    'tournament_id', v_pred.tournament_id,
    'challenge_id', v_pred.challenge_id
  );
END;
$$;

COMMENT ON FUNCTION public.admin_unlock_prediction(UUID, BOOLEAN) IS
  'Reopen ANY user''s bracket: clears the bracket lock and releases pick/round locks on unplayed matches. No ownership check — service_role only, called from /admin/predictions behind assertAdmin().';

-- The ownership clause that protects unlock_prediction() is absent here by
-- design, so the grant is the only thing standing in front of this function.
-- authenticated must never appear on this line.
REVOKE EXECUTE ON FUNCTION public.admin_unlock_prediction(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_unlock_prediction(UUID, BOOLEAN) TO service_role;
