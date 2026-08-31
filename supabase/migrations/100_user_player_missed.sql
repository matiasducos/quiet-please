-- Migration: 100_user_player_missed
-- One player's half of 062, for the stats drawer on the predict page.
--
-- 062's `user_missed_winners` answers "who keeps beating me when I pass on
-- them" as a top-N list, which is the right shape for the dashboard panel. The
-- drawer asks the same question about one named player at the moment the user
-- is choosing between two of them, and a top-N list cannot answer it: the
-- player in front of you is usually not in anyone's top six, and raising the
-- limit until they are means fetching a list that grows with the player
-- registry to read one row out of it.
--
-- So this is deliberately a second function rather than a filter over the
-- first. Cost is bounded by the tournaments the user entered *and* by the
-- matches this one player contested, which is the smaller of the two bounds
-- 062 has to live with.
--
-- Definitions are 062's, unchanged, because the two numbers appear side by side
-- in the product — the dashboard panel and the drawer must never disagree about
-- the same player:
--   missed      — matches this player contested, in a tournament the user
--                 entered, where the user's pick for that match was NOT this
--                 player. A blank slot counts as not picked: declining to back
--                 someone and forgetting to are the same outcome on the
--                 scoreboard, and the bracket is filled in before play.
--   missed_wins — of those, the ones the player won.
--
-- Unlike 062 this does NOT drop the missed_wins = 0 case. That filter is right
-- for a "most costly first" leaderboard, where a player who never punished you
-- is not a story. It is wrong here: "you passed on them 7 times and they won 0"
-- is a real answer to "should I back them", and suppressing it would leave the
-- drawer unable to tell "no history" apart from "harmless history".
--
-- Returns exactly one row. The aggregates are unfiltered by GROUP BY, so a
-- player the user has never encountered yields (0, 0) rather than no row, and
-- the caller needs no empty-set branch.
--
-- Scoped to global predictions (challenge_id is null), like 057, 058 and 062:
-- challenge brackets affect neither ranking nor leagues and would double-count.

create or replace function public.user_player_missed(p_user_id uuid, p_external_id text)
returns table (
  missed      bigint,
  missed_wins bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with preds as (
    -- At most one row per (user, tournament): migration 015 replaced the dropped
    -- table constraint with the partial unique index idx_predictions_global
    -- covering exactly this predicate. That matters here as it does in 062 —
    -- a duplicate would inflate both counts and the ratio between them.
    select p.tournament_id, p.picks
    from public.predictions p
    where p.user_id = p_user_id
      and p.challenge_id is null
  ),
  -- Every match this player contested in a tournament the user entered, paired
  -- with what the user picked for that exact match. A missing key yields NULL,
  -- which is the blank-slot case and is treated as "not picked" below.
  --
  -- 062 has to union winner and loser rows to get one row per participant; a
  -- single-player lookup does not, because a player contests a match exactly
  -- once. The participant filter therefore sits in the join, where it also cuts
  -- the scan down to this player's matches instead of the whole draw's.
  played as (
    select
      mr.winner_external_id,
      pr.picks ->> mr.external_match_id as user_pick
    from public.match_results mr
    join preds pr on pr.tournament_id = mr.tournament_id
    -- NULL-safe: API-synced results carry no score string, and `<> 'BYE'` would
    -- evaluate to NULL for those and drop them. A BYE is not a contested match,
    -- so it can neither be missed nor won.
    where mr.score is distinct from 'BYE'
      and (mr.winner_external_id = p_external_id or mr.loser_external_id = p_external_id)
  )
  select
    count(*)                                                      as missed,
    count(*) filter (where winner_external_id = p_external_id)    as missed_wins
  from played
  -- `is distinct from` rather than `<>` so a blank slot (NULL) counts as not
  -- picked instead of evaluating to NULL and being dropped.
  where user_pick is distinct from p_external_id;
$$;

-- Admin-only, like 057, 058 and 062: this exposes one user's prediction history.
revoke all on function public.user_player_missed(uuid, text) from public, anon, authenticated;
grant execute on function public.user_player_missed(uuid, text) to service_role;

-- No new index required, for the same reason as 062: the join filters
-- match_results on tournament_id, the leading column of the unique
-- (tournament_id, external_match_id) index from 001, and the `preds` scan is
-- served by idx_predictions_user_challenge from 057. The winner/loser predicate
-- is a filter over that already-bounded set, not a driving lookup.
