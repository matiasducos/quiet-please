-- 040: Scramble bot usernames to look more natural
-- Run in Supabase SQL editor.
-- First: run the SELECT at the bottom to verify bots exist.
-- Then: run the full DO block.

DO $$
DECLARE
  bot_rec   RECORD;
  new_name  TEXT;
  style     INT;
  first_part TEXT;
  suffix_part TEXT;
  num_part   TEXT;
  attempts   INT;
  bot_count  INT := 0;

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
    'game', 'point', 'winner', 'champ',
    'fan', 'pro', 'star', 'pick', 'shot',
    'wild', 'seed', 'draw', 'bracket', 'final',
    'open', 'slam', 'tour', 'rank', 'top',
    'hawk', 'eagle', 'lion', 'wolf', 'fox'
  ];

BEGIN
  FOR bot_rec IN
    SELECT u.id, u.username
    FROM public.users u
    JOIN auth.users a ON a.id = u.id
    WHERE a.email LIKE '%@bot.quietplease.app'
  LOOP
    bot_count := bot_count + 1;

    first_part := first_names[1 + floor(random() * 50)::int];
    suffix_part := suffixes[1 + floor(random() * 45)::int];
    num_part := (floor(random() * 99) + 1)::text;
    style := floor(random() * 8)::int;

    new_name := CASE style
      WHEN 0 THEN first_part || '_' || suffix_part
      WHEN 1 THEN first_part || suffix_part
      WHEN 2 THEN first_part || suffix_part || num_part
      WHEN 3 THEN first_part || '_' || suffix_part || num_part
      WHEN 4 THEN first_part || num_part
      WHEN 5 THEN suffix_part || first_part
      WHEN 6 THEN suffix_part || '_' || first_part
      WHEN 7 THEN first_part || first_names[1 + floor(random() * 50)::int]
      ELSE first_part || suffix_part
    END;

    -- Ensure uniqueness
    attempts := 0;
    WHILE EXISTS (SELECT 1 FROM public.users WHERE username = new_name AND id != bot_rec.id) LOOP
      new_name := new_name || (floor(random() * 10))::text;
      attempts := attempts + 1;
      EXIT WHEN attempts > 5;
    END WHILE;

    -- Update username in public.users
    UPDATE public.users SET username = new_name WHERE id = bot_rec.id;

  END LOOP;

  RAISE NOTICE 'Updated % bot usernames', bot_count;
END $$;

-- Verify: run this separately to check results
-- SELECT username FROM public.users u JOIN auth.users a ON a.id = u.id WHERE a.email LIKE '%@bot.quietplease.app' ORDER BY username LIMIT 20;
