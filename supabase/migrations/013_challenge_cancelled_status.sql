-- Add 'cancelled' status for challenges (challenger withdraws before response)
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_valid_status;
ALTER TABLE challenges
  ADD CONSTRAINT challenges_valid_status
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'completed', 'cancelled'));
