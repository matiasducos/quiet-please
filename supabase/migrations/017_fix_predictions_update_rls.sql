-- Fix: the UPDATE policy lacked a WITH CHECK clause, so it defaulted to USING.
-- This prevented setting is_fully_locked = true because the new row would fail
-- the USING check (is_fully_locked = false).
--
-- USING  = which existing rows you can touch  → must be unlocked & yours
-- WITH CHECK = what the new row must satisfy   → must be yours (lock flip allowed)

DROP POLICY IF EXISTS "Users can update non-fully-locked predictions" ON public.predictions;

CREATE POLICY "Users can update non-fully-locked predictions"
  ON public.predictions FOR UPDATE
  USING (auth.uid() = user_id AND is_fully_locked = false)
  WITH CHECK (auth.uid() = user_id);
