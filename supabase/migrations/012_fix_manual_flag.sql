-- 012_fix_manual_flag
-- Mark any tournament with draw_size set as manual (these were created via admin UI
-- but the is_manual flag wasn't set due to a bug in the insert).

UPDATE public.tournaments
SET is_manual = true
WHERE draw_size IS NOT NULL
  AND is_manual = false;
