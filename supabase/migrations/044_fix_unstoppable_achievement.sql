-- Remove incorrectly awarded "unstoppable" achievements.
-- The old threshold (7×) was never legitimately reached by anyone.
-- New threshold is 5× — the cron will re-award correctly on next run.
DELETE FROM user_achievements WHERE achievement_key = 'unstoppable';
