-- Migration: 003_username_setup
-- Tracks whether a user has explicitly chosen their username.
-- Email signups always choose a username at sign-up (username_is_set = true).
-- Google / OAuth signups get an auto-generated username (username_is_set = false)
-- and are redirected to /setup-username before they can use the app.

alter table public.users
  add column if not exists username_is_set boolean not null default true;

-- Rebuild trigger so new OAuth users start with username_is_set = false
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, username, username_is_set)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    -- email signups pass { data: { username } } → raw_user_meta_data has 'username' key
    -- OAuth providers never pass 'username', so this is false for Google etc.
    (new.raw_user_meta_data->>'username') is not null
  );
  return new;
end;
$$;
