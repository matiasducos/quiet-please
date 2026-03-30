-- 038: Fix bot auto-predict players to use players from actual tournament draws.
-- The original seed assigned random players that aren't in any draw.
-- This reassigns each bot 3 players that actually appear in current tournament draws.

DO $$
DECLARE
  bot_rec   RECORD;
  p_rec     RECORD;
  p_priority INT;
BEGIN
  -- Collect all player external_ids that appear in current draws
  -- (accepting_predictions or in_progress tournaments)
  CREATE TEMP TABLE draw_players AS
  SELECT DISTINCT p.external_id, p.name
  FROM public.draws d
  JOIN public.tournaments t ON t.id = d.tournament_id
  JOIN LATERAL (
    SELECT
      jsonb_array_elements(d.bracket_data->'matches') AS match_data
  ) matches ON true
  JOIN public.players p ON
    p.external_id = matches.match_data->'player1'->>'externalId'
    OR p.external_id = matches.match_data->'player2'->>'externalId'
  WHERE t.status IN ('accepting_predictions', 'in_progress')
    AND p.tour = 'ATP';

  -- Check we have enough draw players
  IF (SELECT count(*) FROM draw_players) < 3 THEN
    RAISE NOTICE 'Not enough players in active draws. Found: %', (SELECT count(*) FROM draw_players);
    DROP TABLE draw_players;
    RETURN;
  END IF;

  RAISE NOTICE 'Found % unique ATP players in active draws', (SELECT count(*) FROM draw_players);

  -- For each bot user, replace their auto_predict_players with 3 random draw players
  FOR bot_rec IN
    SELECT id FROM public.users WHERE email LIKE '%@bot.quietplease.app'
  LOOP
    -- Delete existing player configs
    DELETE FROM public.auto_predict_players WHERE user_id = bot_rec.id;

    -- Assign 3 random players from draws
    p_priority := 0;
    FOR p_rec IN
      SELECT external_id, name FROM draw_players ORDER BY random() LIMIT 3
    LOOP
      p_priority := p_priority + 1;
      INSERT INTO public.auto_predict_players (
        user_id, tour, surface, player_external_id, player_name, priority
      ) VALUES (
        bot_rec.id, 'ATP', NULL, p_rec.external_id, p_rec.name, p_priority
      );
    END LOOP;
  END LOOP;

  DROP TABLE draw_players;
  RAISE NOTICE 'Reassigned auto-predict players for all bots using draw players';
END $$;
