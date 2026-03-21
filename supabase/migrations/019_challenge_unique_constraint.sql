-- Prevent duplicate active challenges between the same pair of users for the same tournament.
-- Uses LEAST/GREATEST to make the constraint direction-agnostic (A→B == B→A).
CREATE UNIQUE INDEX IF NOT EXISTS idx_challenges_active_pair
  ON challenges (
    LEAST(challenger_id, challenged_id),
    GREATEST(challenger_id, challenged_id),
    tournament_id
  )
  WHERE status IN ('pending', 'accepted');
