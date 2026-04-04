-- 040: Scramble bot usernames to look more natural
-- The original seed used a uniform pattern: first_suffix00
-- This randomizes the format per bot: some drop underscores, some drop numbers,
-- some use different separators, some capitalize differently.
-- Run in Supabase SQL editor.

DO $$
DECLARE
  bot_rec   RECORD;
  new_name  TEXT;
  style     INT;
  first_part TEXT;
  suffix_part TEXT;
  num_part   TEXT;
  attempts   INT;

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
    SELECT id, username FROM public.users
    WHERE email LIKE '%@bot.quietplease.app'
    ORDER BY random()
  LOOP
    -- Pick random parts
    first_part := first_names[1 + floor(random() * array_length(first_names, 1))::int];
    suffix_part := suffixes[1 + floor(random() * array_length(suffixes, 1))::int];
    num_part := (floor(random() * 99) + 1)::text;

    -- Pick a random style (0-7) for variety
    style := floor(random() * 8)::int;

    new_name := CASE style
      -- No number, with underscore: "alex_rally"
      WHEN 0 THEN first_part || '_' || suffix_part
      -- No number, no underscore: "alexrally"
      WHEN 1 THEN first_part || suffix_part
      -- Number, no underscore: "alexrally7"
      WHEN 2 THEN first_part || suffix_part || num_part
      -- Number with underscore: "alex_rally7"
      WHEN 3 THEN first_part || '_' || suffix_part || num_part
      -- Just name + number: "alex42"
      WHEN 4 THEN first_part || num_part
      -- Suffix first: "rallyalex"
      WHEN 5 THEN suffix_part || first_part
      -- Suffix + number: "rally_alex9"
      WHEN 6 THEN suffix_part || '_' || first_part || (CASE WHEN random() > 0.5 THEN num_part ELSE '' END)
      -- Double name: "alexjordan"
      WHEN 7 THEN first_part || first_names[1 + floor(random() * array_length(first_names, 1))::int]
      ELSE first_part || suffix_part
    END;

    -- Ensure uniqueness with retry
    attempts := 0;
    LOOP
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.users WHERE username = new_name AND id != bot_rec.id
      );
      -- Append a random digit to resolve collision
      new_name := new_name || (floor(random() * 10))::text;
      attempts := attempts + 1;
      EXIT WHEN attempts > 5;
    END LOOP;

    UPDATE public.users SET username = new_name WHERE id = bot_rec.id;
    UPDATE auth.users SET email = new_name || '@bot.quietplease.app' WHERE id = bot_rec.id;
  END LOOP;

  RAISE NOTICE 'Scrambled all bot usernames';
END $$;
