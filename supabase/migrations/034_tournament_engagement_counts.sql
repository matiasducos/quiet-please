-- Count global predictions (not challenge-specific) per tournament
CREATE OR REPLACE FUNCTION count_predictions_by_tournament(t_ids uuid[])
RETURNS TABLE(tournament_id uuid, cnt bigint) AS $$
  SELECT p.tournament_id, COUNT(*) as cnt
  FROM public.predictions p
  WHERE p.tournament_id = ANY(t_ids)
    AND p.challenge_id IS NULL
  GROUP BY p.tournament_id
$$ LANGUAGE sql STABLE
SET search_path = public;

-- Count active challenges per tournament (all non-cancelled/expired/declined statuses)
CREATE OR REPLACE FUNCTION count_challenges_by_tournament(t_ids uuid[])
RETURNS TABLE(tournament_id uuid, cnt bigint) AS $$
  SELECT c.tournament_id, COUNT(*) as cnt
  FROM public.challenges c
  WHERE c.tournament_id = ANY(t_ids)
    AND c.status NOT IN ('cancelled', 'expired', 'declined')
  GROUP BY c.tournament_id
$$ LANGUAGE sql STABLE
SET search_path = public;
