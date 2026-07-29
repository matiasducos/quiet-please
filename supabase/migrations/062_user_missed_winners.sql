-- Migration: 062_user_missed_winners
-- The inverse of 057's player stats: players the user did NOT back for a match,
-- who went on to win it anyway.
--
-- 057 answers "who do I pick, and what did they return". This answers the
-- opposite and more uncomfortable question: who keeps beating me when I pass on
-- them. Both are needed to read a record honestly — a player can be a strong
-- earner and still be someone you routinely drop a round too early.
--
-- Definitions:
--   missed      — matches this player contested, in a tournament the user
--                 entered, where the user's pick for that match was NOT this
--                 player. A slot left blank counts as not picked: declining to
--                 back someone and forgetting to are the same outcome on the
--                 scoreboard, and the bracket is filled in before play.
--   missed_wins — of those, the ones the player won. The absolute "they got me"
--                 count; missed_wins / missed is the rate.
--   picks       — how many slots the user DID back this player in, carried over
--                 from 057 so the UI can tell "never backed them once" apart
--                 from "backed them, then dropped them at the wrong moment".
--
-- Both a player the user has never picked and one they pick constantly appear
-- here; being absent from 057's list is exactly what makes a blind spot a blind
-- spot, so restricting to already-picked players would hide the interesting case.
--
-- Same reason this is SQL rather than Node as 057/058: it needs every
-- match_result across every tournament the user entered (1,010 rows for the
-- heaviest user today), which is past the 1000-row PostgREST cap. Done
-- client-side it would silently under-report with no error.
--
-- Cost is bounded by how many tournaments that one user entered, not by the
-- size of the user base, so this does not degrade as the app grows.
--
-- Scoped to global predictions (challenge_id is null), like 057 and 058:
-- challenge brackets affect neither ranking nor leagues and would double-count.

create or replace function public.user_missed_winners(p_user_id uuid, p_limit int default 12)
returns table (
  external_id text,
  name        text,
  country     text,
  picks       bigint,
  missed      bigint,
  missed_wins bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with preds as (
    -- No de-duplication needed here. Migration 015 dropped the table constraint
    -- on (user_id, tournament_id) but replaced it with the partial unique index
    -- idx_predictions_global covering exactly this predicate, so at most one
    -- global prediction per (user, tournament) can exist. That matters more than
    -- usual below: a ratio cannot absorb a double-counted match the way 057's
    -- count(distinct ...) can.
    select p.id, p.tournament_id, p.picks
    from public.predictions p
    where p.user_id = p_user_id
      and p.challenge_id is null
  ),
  -- Every played match in the tournaments this user entered, paired with what
  -- the user picked for that exact match. A missing key yields NULL, which is
  -- the blank-slot case and is treated as "not picked" below.
  played as (
    select
      mr.id                             as match_result_id,
      mr.winner_external_id,
      mr.loser_external_id,
      pr.picks ->> mr.external_match_id as user_pick
    from public.match_results mr
    join preds pr on pr.tournament_id = mr.tournament_id
    -- NULL-safe: API-synced results carry no score string, and `<> 'BYE'` would
    -- evaluate to NULL for those and drop them. A BYE is not a contested match,
    -- so it can neither be missed nor won.
    where mr.score is distinct from 'BYE'
  ),
  -- One row per (match, participant). Both columns are NOT NULL on the table,
  -- so every played match contributes exactly two rows.
  participants as (
    select match_result_id, winner_external_id as ext_id, user_pick, true  as is_win
    from played
    union all
    select match_result_id, loser_external_id,  user_pick, false
    from played
  ),
  missed as (
    select
      ext_id,
      count(*)                       as missed,
      count(*) filter (where is_win) as missed_wins
    from participants
    -- `is distinct from` rather than `<>` so a blank slot (NULL) counts as
    -- not picked instead of evaluating to NULL and being dropped.
    where user_pick is distinct from ext_id
    group by ext_id
  ),
  picked as (
    -- Mirrors 057's `picked` CTE: one row per (prediction, match) slot the user
    -- backed this player in, so backing someone deep counts once per round.
    select kv.value as ext_id, count(*) as picks
    from preds pr, lateral jsonb_each_text(pr.picks) kv
    where kv.value is not null and kv.value <> ''
    group by kv.value
  )
  select
    m.ext_id              as external_id,
    pl.name               as name,
    pl.country            as country,
    coalesce(pk.picks, 0) as picks,
    m.missed,
    m.missed_wins
  from missed m
  left join picked pk on pk.ext_id = m.ext_id
  -- Names come from the registry rather than a draw snapshot: an all-time view
  -- spans many draws, and the registry is the one place that has every player.
  left join public.players pl on pl.external_id = m.ext_id
  -- A player who never won a match after being passed over is not a miss.
  where m.missed_wins > 0
  order by m.missed_wins desc, m.missed desc, pl.name
  limit greatest(p_limit, 1);
$$;

-- Admin-only, like 057 and 058: this exposes one user's full prediction history.
revoke all on function public.user_missed_winners(uuid, int) from public, anon, authenticated;
grant execute on function public.user_missed_winners(uuid, int) to service_role;

-- No new index required: the `played` join filters match_results on
-- tournament_id, already covered by the leading column of the
-- unique (tournament_id, external_match_id) index from 001, and the `preds`
-- scan is served by idx_predictions_user_challenge from 057.
