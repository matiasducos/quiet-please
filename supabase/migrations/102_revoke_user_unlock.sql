-- Migration: 102_revoke_user_unlock
-- Description: Take the unlock away from users. Locking is final again; only an
--              admin can reopen a bracket.
-- Run manually in Supabase dashboard (project not linked locally)

-- ============================================================
-- WHAT CHANGED, AND WHY THIS IS A REVOKE RATHER THAN A DROP
--
-- 094/095 gave users a way out of a lock and 099 rewrote both functions. That
-- is now withdrawn as a product decision: "Lock all picks", "Lock {round}" and
-- "Lock pick" are one-way again from inside the app.
--
-- The UI and the server actions are gone in the same change, so nothing calls
-- these two any more. This migration closes the door properly: a server action
-- can be re-added by accident, and until this runs, any signed-in user could
-- still reach `unlock_prediction` directly over PostgREST's /rpc endpoint with
-- their own access token. Removing the UI is not removing the capability.
--
-- They are revoked, not dropped, for three reasons:
--
--   * `admin_unlock_prediction` (096, rewritten in 099) is the supported way to
--     reopen a bracket and stays granted to service_role. The two here are its
--     tested siblings and share its rules; dropping them would leave the admin
--     path as the only implementation of a transition that has been verified
--     three times.
--   * The decision is a product one and may reverse. A revoke reverses with one
--     GRANT; a drop means restoring two function bodies from git.
--   * A dropped function that something still references fails at call time
--     with a missing-function error. A revoked one fails at permission time,
--     which is the honest description of what happened.
--
-- `unlocked_at` / `unlock_count` (094) stay. They carry the auto-predict cron's
-- "this bracket is the user's now" guard, which is unrelated to who may call
-- the unlock, and they are the record of the brackets already reopened.
-- ============================================================

-- Signed-in users may no longer unlock anything. service_role keeps both so the
-- admin tooling and any future script can still run them deliberately.
REVOKE EXECUTE ON FUNCTION public.unlock_prediction(UUID)          FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.unlock_picks(UUID, TEXT[])       FROM authenticated;

-- Belt and braces: PUBLIC and anon were revoked when these were created, but a
-- later CREATE OR REPLACE re-grants EXECUTE to PUBLIC by default, and 099 has
-- already replaced both once.
REVOKE EXECUTE ON FUNCTION public.unlock_prediction(UUID)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unlock_picks(UUID, TEXT[])       FROM PUBLIC, anon;

GRANT  EXECUTE ON FUNCTION public.unlock_prediction(UUID)          TO service_role;
GRANT  EXECUTE ON FUNCTION public.unlock_picks(UUID, TEXT[])       TO service_role;

COMMENT ON FUNCTION public.unlock_prediction(UUID) IS
  'Reopen your own fully-locked bracket. NO LONGER REACHABLE BY USERS (102) — service_role only; the supported path is admin_unlock_prediction().';
COMMENT ON FUNCTION public.unlock_picks(UUID, TEXT[]) IS
  'Release commitments on specific unplayed matches. NO LONGER REACHABLE BY USERS (102) — service_role only.';
