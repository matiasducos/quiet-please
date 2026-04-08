-- Enable RLS on cron_runs to close the "table publicly accessible" security warning.
-- No policies needed — only the service role (admin client) writes to this table,
-- and service role bypasses RLS. With RLS enabled and zero policies, anon/authenticated
-- users have no access.

alter table public.cron_runs enable row level security;
