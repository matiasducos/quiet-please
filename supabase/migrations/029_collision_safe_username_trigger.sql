-- Migration 029: Collision-safe username generation
--
-- Now that email signups no longer pass a username, ALL new users get an
-- auto-generated username from their email prefix. This can collide
-- (e.g. two john@ emails), so the trigger now appends random digits on collision.
-- All new users start with username_is_set = false and go through /setup-username.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  attempts INT := 0;
BEGIN
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
