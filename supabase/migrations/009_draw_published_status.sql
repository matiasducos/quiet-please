-- 009_draw_published_status.sql
-- Adds 'draw_published' to the tournament status lifecycle.
--
-- New status flow:
--   upcoming → draw_published → accepting_predictions → in_progress → completed
--
-- draw_published means: the draw bracket structure has been synced (e.g., qualifying
-- round shells) but player names are not yet assigned — predictions should NOT open yet.
-- sync-draws will automatically advance to accepting_predictions once named players appear.

-- Drop the old constraint (auto-named by PostgreSQL from the column-level CHECK in 001)
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_status_check;

-- Re-add with 'draw_published' included
ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_status_check
  CHECK (status IN ('upcoming', 'draw_published', 'accepting_predictions', 'in_progress', 'completed'));
