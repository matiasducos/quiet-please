-- Cron run logging — tracks every cron execution for observability.
-- Written by admin client (service role) only. No RLS needed.

create table public.cron_runs (
  id          uuid primary key default gen_random_uuid(),
  job_name    text not null,                    -- 'award-points', 'sync-draws', etc.
  status      text not null default 'running',  -- 'running' | 'success' | 'error'
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms int,
  summary     jsonb,                            -- job-specific counts
  error       text                              -- error message if status = 'error'
);

create index idx_cron_runs_job_started on cron_runs (job_name, started_at desc);
