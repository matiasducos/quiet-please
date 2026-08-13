-- Migration 083: refuse a provider sign-in that carries no email address
--
-- `public.users.email` is `text not null` (001) and handle_new_user() copies
-- `auth.users.email` straight into it. Google always returns an address, so the
-- assumption held for as long as Google was the only OAuth provider. Facebook
-- breaks it two ways: an account registered against a phone number has no email
-- at all, and Facebook's consent dialog lets someone untick the email
-- permission on an account that does have one. Either way the provider hands
-- back a NULL.
--
-- What that did before this migration, in order:
--   1. base_username derives from SPLIT_PART(NEW.email, '@', 1). Every string
--      function in that chain propagates NULL, so base_username came out NULL.
--   2. The `LENGTH(base_username) < 3` padding branch did NOT catch it —
--      LENGTH(NULL) is NULL, and `NULL < 3` is NULL, which is not TRUE.
--   3. `WHERE username = final_username` never matches when final_username is
--      NULL, so the collision loop spun zero times and exited cleanly.
--   4. The INSERT then failed on the `email` NOT NULL constraint — raising a
--      generic Postgres error the application cannot tell apart from any other
--      database fault, and only after the sign-in had appeared to succeed.
--
-- Failing deliberately, first, and by name is the whole change. It costs one
-- comparison, it aborts before any row is written, and 'no_email_from_provider'
-- is greppable in the Supabase auth logs — which is what turns a confused user
-- report into a two-second diagnosis.
--
-- Deliberately NOT relaxing users.email to nullable. The unsubscribe tokens,
-- the draw-open announcement, the anonymous result mail and every cron that
-- reads users.email_notifications all assume an address exists; 157 of 157 rows
-- have one today. Admitting a handful of Facebook accounts without one would
-- push a NULL check into every one of those paths. A provider that will not
-- identify the person is the thing to reject, not an invariant to weaken.
--
-- Everything below is 029 verbatim apart from the guard block. Restated in full
-- because CREATE OR REPLACE FUNCTION has no partial form.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  attempts INT := 0;
BEGIN
  -- The guard. Raised before any write so the transaction rolls back with no
  -- half-created account left behind.
  IF NEW.email IS NULL OR LENGTH(TRIM(NEW.email)) = 0 THEN
    RAISE EXCEPTION 'no_email_from_provider'
      USING HINT = 'The identity provider returned no email address. '
                || 'An account cannot be created without one.';
  END IF;

  -- Use explicit username from metadata if provided, otherwise derive from email
  base_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    LOWER(REGEXP_REPLACE(SPLIT_PART(NEW.email, '@', 1), '[^a-z0-9_]', '', 'g'))
  );

  -- Ensure minimum length (pad short prefixes)
  IF LENGTH(base_username) < 3 THEN
    base_username := base_username || '_user';
  END IF;

  -- Truncate to leave room for collision suffix
  base_username := LEFT(base_username, 16);

  -- Try base username, then append random 4-digit suffix on collision
  final_username := base_username;
  WHILE EXISTS (SELECT 1 FROM public.users WHERE username = final_username) LOOP
    final_username := base_username || '_' || FLOOR(RANDOM() * 9000 + 1000)::TEXT;
    attempts := attempts + 1;
    IF attempts > 10 THEN
      -- Fallback: use UUID fragment to guarantee uniqueness
      final_username := base_username || '_' || LEFT(REPLACE(GEN_RANDOM_UUID()::TEXT, '-', ''), 6);
      EXIT;
    END IF;
  END LOOP;

  INSERT INTO public.users (id, email, username, username_is_set)
  VALUES (
    NEW.id,
    NEW.email,
    final_username,
    -- Only true if username was explicitly provided in signup metadata
    (NEW.raw_user_meta_data->>'username') IS NOT NULL
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Mirrors a new auth.users row into public.users with a collision-safe '
  'username. Rejects a provider sign-in carrying no email address '
  '(no_email_from_provider) rather than failing later on the NOT NULL '
  'constraint — see migration 083.';
