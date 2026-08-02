-- 071: admin_actions — audit trail for destructive actions taken from /admin
--
-- Deleting a user from the admin panel previously left no record beyond a line
-- in the Vercel function log. For a GDPR-relevant action that is not enough:
-- there was no way to answer "who removed this account, and when".

create table public.admin_actions (
  id           uuid        primary key default gen_random_uuid(),

  -- DELIBERATELY NOT FOREIGN KEYS.
  -- This table records the deletion of the very rows these ids point at. A
  -- reference to users(id) would cascade, so deleting a user would delete the
  -- record that they were deleted — the log would erase the events it exists
  -- to prove. actor_id has the same problem one step removed: an admin whose
  -- own account is closed later must not take their audit history with them.
  actor_id     uuid,
  target_id    uuid,

  -- Snapshots taken at write time. Once the target row is gone there is
  -- nothing left to resolve the id against, so these are the only human
  -- readable record of who was involved.
  actor_label  text        not null,
  target_label text        not null,

  action       text        not null check (action in ('user.delete')),
  target_type  text        not null check (target_type in ('user')),

  -- Action-specific detail: for user.delete, the impact snapshot shown on the
  -- confirmation screen plus what happened to any owned leagues.
  meta         jsonb       not null default '{}',
  created_at   timestamptz not null default now()
);

-- "What has been done lately", the panel's default view.
create index idx_admin_actions_created on public.admin_actions (created_at desc);
-- "What happened to this account", answerable long after the row is gone.
create index idx_admin_actions_target  on public.admin_actions (target_id);

-- RLS on with no policies: no anon or authenticated role can read or write
-- this table at all. The service role bypasses RLS, so the admin client is the
-- only way in. This holds the email addresses of deleted users, so unlike
-- cron_runs it must not be world readable.
alter table public.admin_actions enable row level security;

comment on table public.admin_actions is
  'Audit trail for destructive admin actions. Intentionally free of foreign keys: it outlives the rows it describes.';
