-- 027_anonymous_challenges.sql
-- Self-contained bracket challenges shareable via link, no account required.
-- Picks stored as JSONB directly on the challenge row.

-- ── A. Make challenger_id / challenged_id NULLABLE ───────────────────────
-- Anonymous challenges have no auth users; these columns stay NULL.
-- FK constraints still enforce validity when values ARE present.

ALTER TABLE public.challenges ALTER COLUMN challenger_id DROP NOT NULL;
ALTER TABLE public.challenges ALTER COLUMN challenged_id DROP NOT NULL;

-- Update the no-self constraint to tolerate NULLs
ALTER TABLE public.challenges DROP CONSTRAINT IF EXISTS challenges_no_self;
ALTER TABLE public.challenges ADD CONSTRAINT challenges_no_self
  CHECK (challenger_id IS NULL OR challenged_id IS NULL OR challenger_id <> challenged_id);

-- ── B. New columns ──────────────────────────────────────────────────────

-- Short alphanumeric code for /c/[code] URLs
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS share_code TEXT UNIQUE;

-- Distinguishes anonymous from friends-based challenges
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT false;

-- Display names for anonymous players
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS creator_name TEXT;
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS opponent_name TEXT;

-- Self-contained bracket picks (same format as predictions.picks: { matchId: playerExternalId })
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS creator_picks JSONB;
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS opponent_picks JSONB;

-- localStorage-based identity tokens (UUIDs)
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS creator_token TEXT;
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS opponent_token TEXT;

-- Per-pick lock state (mirrors predictions.pick_locks: { matchId: "auto" })
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS creator_pick_locks JSONB NOT NULL DEFAULT '{}';
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS opponent_pick_locks JSONB NOT NULL DEFAULT '{}';

-- ── C. Expand status constraint ─────────────────────────────────────────
-- Add 'waiting_opponent' (created, link shared) and 'active' (opponent submitted)
-- for anonymous challenges. Keep all existing statuses.

ALTER TABLE public.challenges DROP CONSTRAINT IF EXISTS challenges_valid_status;
ALTER TABLE public.challenges ADD CONSTRAINT challenges_valid_status
  CHECK (status IN (
    'pending', 'accepted', 'declined', 'expired', 'completed', 'cancelled',
    'waiting_opponent', 'active'
  ));

-- ── D. Indexes ──────────────────────────────────────────────────────────

-- Fast lookups by share_code (for /c/[code] route)
CREATE INDEX IF NOT EXISTS idx_challenges_share_code
  ON public.challenges (share_code)
  WHERE share_code IS NOT NULL;

-- Cron: find active anonymous challenges to score
CREATE INDEX IF NOT EXISTS idx_challenges_anon_active
  ON public.challenges (tournament_id)
  WHERE is_anonymous = true AND status = 'active';

-- ── E. RLS: allow public reads for anonymous challenges ─────────────────
-- Anyone with the share link can read the challenge.
-- All writes go through admin client (service role), so no write policy needed.

CREATE POLICY "anon_challenges_public_read"
  ON public.challenges FOR SELECT
  USING (is_anonymous = true AND share_code IS NOT NULL);
