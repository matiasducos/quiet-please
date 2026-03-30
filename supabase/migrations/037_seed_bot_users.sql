-- 037: Seed 100 bot users with auto-predict enabled
-- Run in Supabase SQL editor. Creates auth.users + public.users + auto_predict_players.
-- Each bot gets 3 random ATP players from the players table as their default priority list.

DO $$
DECLARE
  bot_id       UUID;
  bot_username TEXT;
  bot_email    TEXT;
  bot_country  TEXT;
  i            INT;
  p_rec        RECORD;
  p_priority   INT;
  atp_players  UUID[];

  -- 30 countries for variety
  countries TEXT[] := ARRAY[
    'United States', 'Spain', 'France', 'Italy', 'Germany',
    'United Kingdom', 'Argentina', 'Australia', 'Brazil', 'Canada',
    'Serbia', 'Greece', 'Russia', 'Switzerland', 'Norway',
    'Denmark', 'Netherlands', 'Poland', 'Czech Republic', 'Japan',
    'Croatia', 'Belgium', 'Austria', 'Chile', 'Portugal',
    'South Korea', 'India', 'Colombia', 'Mexico', 'Sweden'
  ];

  -- Name parts for generating realistic-ish usernames
  first_names TEXT[] := ARRAY[
    'alex', 'jordan', 'taylor', 'casey', 'riley',
    'morgan', 'avery', 'quinn', 'blake', 'cameron',
    'drew', 'parker', 'charlie', 'skyler', 'sam',
    'jamie', 'rowan', 'sage', 'reese', 'dakota',
    'finley', 'hayden', 'emerson', 'addison', 'river',
    'phoenix', 'harley', 'marley', 'frankie', 'remy',
    'lennox', 'milan', 'nico', 'kai', 'ellis',
    'tatum', 'lennon', 'royal', 'arden', 'shiloh',
    'marco', 'luca', 'mateo', 'carlos', 'andres',
    'ivan', 'yuki', 'omar', 'ravi', 'felix'
  ];

  suffixes TEXT[] := ARRAY[
    'ace', 'rally', 'spin', 'serve', 'volley',
    'net', 'set', 'match', 'court', 'deuce',
    'smash', 'drop', 'slice', 'flat', 'kick',
    'clay', 'grass', 'hard', 'break', 'love',
    'game', 'point', 'tiebreak', 'winner', 'champ',
    'fan', 'pro', 'star', 'king', 'boss',
    'pick', 'pred', 'bet', 'call', 'shot',
    'wild', 'seed', 'draw', 'bracket', 'final',
    'open', 'slam', 'tour', 'rank', 'top',
    'hawk', 'eagle', 'lion', 'wolf', 'fox'
  ];

BEGIN
  -- Clean up any partially created bots from a previous failed run
  DELETE FROM public.auto_predict_players WHERE user_id IN (
    SELECT id FROM public.users WHERE email LIKE '%@bot.quietplease.app'
  );
  DELETE FROM public.users WHERE email LIKE '%@bot.quietplease.app';
  DELETE FROM auth.users WHERE email LIKE '%@bot.quietplease.app';

  RAISE NOTICE 'Cleaned up previous bot data (if any)';

  -- Collect all ATP player IDs into an array for random selection
  SELECT array_agg(id ORDER BY random()) INTO atp_players
  FROM public.players
  WHERE tour = 'ATP';

  IF array_length(atp_players, 1) IS NULL OR array_length(atp_players, 1) < 3 THEN
    RAISE EXCEPTION 'Need at least 3 ATP players in the players table. Found: %', COALESCE(array_length(atp_players, 1), 0);
  END IF;

  FOR i IN 1..100 LOOP
    bot_id := gen_random_uuid();
    bot_username := first_names[1 + floor(random() * array_length(first_names, 1))::int]
                 || '_'
                 || suffixes[1 + floor(random() * array_length(suffixes, 1))::int]
                 || lpad(i::text, 2, '0');
    bot_email := bot_username || '@bot.quietplease.app';
    bot_country := countries[1 + floor(random() * array_length(countries, 1))::int];

    -- 1. Insert into auth.users (trigger auto-creates public.users row)
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin, confirmation_token
    ) VALUES (
      bot_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      bot_email,
      '$2a$10$PwTnSXGMM6FkNMXxFMY9juWLhDQ7J4g3RqERxwLp4s3qPaG0B1ybW',
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      false,
      ''
    );

    -- 2. Update the auto-created public.users row with bot details
    UPDATE public.users SET
      username = bot_username,
      country = bot_country,
      auto_predict_enabled = true,
      created_at = now() - (random() * interval '60 days')
    WHERE id = bot_id;

    -- 3. Assign 3 random ATP players as default priority list
    -- Shuffle the players array and pick the first 3
    p_priority := 0;
    FOR p_rec IN
      SELECT p.external_id, p.name
      FROM public.players p
      WHERE p.tour = 'ATP'
      ORDER BY random()
      LIMIT 3
    LOOP
      p_priority := p_priority + 1;
      INSERT INTO public.auto_predict_players (
        user_id, tour, surface, player_external_id, player_name, priority
      ) VALUES (
        bot_id, 'ATP', NULL, p_rec.external_id, p_rec.name, p_priority
      );
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Created 100 bot users with auto-predict enabled';
END $$;
