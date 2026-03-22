-- Migration: 022_leave_delete_league
-- Adds: members can leave leagues, owners can delete leagues,
--        league_member_joined notification type.

-- ── 1. Members can remove themselves from leagues ───────────────────────────
create policy "Members can leave leagues"
  on public.league_members for delete
  using (user_id = auth.uid());

-- ── 2. Owners can delete their leagues ──────────────────────────────────────
create policy "Owners can delete their leagues"
  on public.leagues for delete
  using (owner_id = auth.uid());

-- ── 3. Add league_member_joined notification type ───────────────────────────
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
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
    'league_member_joined'
  ));
