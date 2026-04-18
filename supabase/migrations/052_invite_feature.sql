-- 052_invite_feature.sql
-- Adds the "Invite a Friend" feature primitives:
--   • public.referrals    — ledger of inviter → invitee relationships
--   • notifications CHECK — adds 'referral_joined' type
-- The Recruiter achievements are defined in code (src/lib/achievements/definitions.ts)
-- and awarded via the existing user_achievements table — no schema change needed.

-- ── referrals table ──────────────────────────────────────────────
-- One row per successful invitee signup. `invitee_id` is UNIQUE so an invitee
-- can only be attributed to a single inviter, ever. Self-referral is blocked
-- by the CHECK constraint. Counts per inviter come from COUNT(*) WHERE
-- inviter_id = X AND first_prediction_at IS NOT NULL — no denormalized counter.

CREATE TABLE IF NOT EXISTS public.referrals (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id          uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  invitee_id          uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at           timestamptz NOT NULL DEFAULT now(),
  first_prediction_at timestamptz,
  reward_granted_at   timestamptz,
  CONSTRAINT referrals_invitee_unique UNIQUE (invitee_id),
  CONSTRAINT referrals_no_self CHECK (inviter_id != invitee_id)
);

-- Targeted lookups: inviter dashboard counter + cron/action hunting for
-- un-rewarded invitees. Partial index keeps the second one tiny.
CREATE INDEX IF NOT EXISTS idx_referrals_inviter
  ON public.referrals (inviter_id);

CREATE INDEX IF NOT EXISTS idx_referrals_pending_reward
  ON public.referrals (inviter_id)
  WHERE first_prediction_at IS NOT NULL AND reward_granted_at IS NULL;

-- ── RLS ──────────────────────────────────────────────────────────
-- Users can read rows where they are either side (for own-profile counters
-- and "invited by X" display). Writes go through the admin client only.
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own referrals"
  ON public.referrals FOR SELECT
  TO authenticated
  USING (auth.uid() = inviter_id OR auth.uid() = invitee_id);

-- No INSERT/UPDATE/DELETE policies → service role only.

-- ── notifications CHECK constraint: add 'referral_joined' ────────
-- Must re-declare the full list (Postgres has no ADD VALUE for CHECK IN).
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'draw_open',
    'points_awarded',
    'challenge_received',
    'challenge_cancelled',
    'challenge_picks_locked',
    'friend_request',
    'friend_accepted',
    'friend_picks_locked',
    'league_member_joined',
    'league_member_left',
    'league_deleted',
    'league_ownership_transferred',
    'auto_predictions_generated',
    'achievement_earned',
    'referral_joined'
  ));
