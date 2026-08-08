-- Migration: 076_tournament_recaps
-- The end-of-tournament recap: what the crowd got right, and who it got wrong.
--
-- Why this is a stored payload rather than a query
-- ------------------------------------------------
-- point_ledger answers half of these questions for free — it is indexed on
-- tournament_id and match_result_id, and 074 already leans on that. But it
-- only ever holds CORRECT picks: one row per prediction per match called right.
-- A bracket that backed Zverev and got it wrong left no row anywhere except its
-- own predictions.picks jsonb.
--
-- So every "who was picked the most / least / backed to win it" question is
-- unanswerable from the ledger by construction, and has to expand the picks
-- object of every global bracket in the tournament. At 10k users that is
-- ~10k x 127 = 1.3M pick entries. Once, at completion: fine. On every homepage
-- render: not fine, and the homepage is the most-hit route in the app.
--
-- Hence: compute once when the tournament finishes, store the answer, serve it
-- from a single indexed row forever after. The homepage's "Recent results"
-- section then costs one `select payload from tournament_recaps` regardless of
-- how many users the app has, which is the whole point.
--
-- Three data hazards this function has to route around
-- ----------------------------------------------------
-- 1. Locked picks. 045 records picks made after a match already started;
--    user_round_stats (057) excludes them from "correct". If the recap counted
--    them, a user's own profile would disagree with the tournament recap about
--    the same match. Excluded here for the same reason.
--
-- 2. Off-draw picks. 064 found that 4.8% of global pick slots name a player who
--    is not in that tournament's draw at all — unresolved `qualifier-N`
--    placeholders, plus late withdrawals re-entered by hand. Counting those
--    would put "qualifier-3" among the most-picked players. Filtered to the
--    tournament's actual cast below.
--
-- 3. Challenge brackets. point_ledger and predictions both carry them, and a
--    user in three challenges contributes four rows for the same match. Every
--    CTE here scopes to `challenge_id is null`, same as 074.
--
-- Void picks are deliberately KEPT. A pick for a round its player never reached
-- (058/060's vocabulary) cannot score, but "31% of you had Sinner lifting the
-- trophy" is a true statement about what the crowd believed, and it stays true
-- when Sinner loses in the third round. That belief is the story this feature
-- exists to tell, so pick popularity counts void picks and accuracy does not.

-- ── Storage ──────────────────────────────────────────────────────────────────

create table if not exists public.tournament_recaps (
  tournament_id  uuid primary key references public.tournaments(id) on delete cascade,
  payload        jsonb       not null,
  -- Results get corrected after the fact (rerunTournamentPoints exists for
  -- exactly that), so a recap is a snapshot with an age, not a permanent fact.
  -- The admin rebuild button and this column are what make a stale one visible.
  built_at       timestamptz not null default now()
);

alter table public.tournament_recaps enable row level security;

-- Public read. The payload is aggregate-only: counts, percentages, player names
-- from the registry, and the top-3 usernames that /leaderboard already shows to
-- anonymous visitors. No user ids, no emails, nothing per-person that is not
-- already public. The homepage renders this for logged-out visitors, so
-- anything narrower would mean reaching for the admin client on the busiest
-- public route.
create policy "Tournament recaps are publicly readable"
  on public.tournament_recaps for select using (true);

-- Writes are service-role only (completion hook + admin rebuild). No insert,
-- update or delete policy exists, so RLS denies those to anon and authenticated.

comment on table public.tournament_recaps is
  'One stored end-of-tournament stats payload per tournament. Built at completion by build_tournament_recap().';

-- ── Player name resolution ───────────────────────────────────────────────────
-- Declared BEFORE the builder that calls it: Postgres parses and validates a
-- `language sql` body at CREATE time, so a forward reference fails the
-- migration rather than resolving later.
--
-- Names come from the registry, not from the draw's embedded snapshot. The
-- registry row is what an admin corrects when a name was entered wrong, and a
-- recap rebuilt afterwards should pick the correction up; bracket_data keeps
-- its own stale copy by design (see 056).
create or replace function public.player_json(p_external_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_external_id is null or p_external_id = '' then null
    else jsonb_build_object(
      'id', p_external_id,
      -- Falls back to the external id rather than null: a player missing from
      -- the registry should render as something a human can trace, not a blank.
      'name', coalesce(
        (select pl.name from public.players pl where pl.external_id = p_external_id),
        p_external_id
      ),
      'country', (
        select nullif(pl.country, '') from public.players pl where pl.external_id = p_external_id
      )
    )
  end
$$;

-- ── The build ────────────────────────────────────────────────────────────────

create or replace function public.build_tournament_recap(t_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with
  -- The tournament's actual cast: every player appearing in a result, winner or
  -- loser. This is the 064 filter. BYE rows are included here on purpose — a
  -- player who received a bye is genuinely in the draw and can be picked — even
  -- though `res` below drops them as matches.
  cast_ids as (
    select distinct pid
    from (
      select winner_external_id as pid from public.match_results where tournament_id = t_id
      union all
      select loser_external_id  as pid from public.match_results where tournament_id = t_id
    ) s
    where pid is not null and pid <> ''
  ),

  -- Played matches. `is distinct from` rather than `<> 'BYE'`: API-synced rows
  -- carry a null score, and `<> 'BYE'` evaluates to NULL for those and would
  -- silently drop every synced result. Same guard as 057.
  res as (
    select
      mr.id, mr.external_match_id, mr.round, mr.score,
      mr.winner_external_id, mr.loser_external_id,
      array_position(array['R128','R64','R32','R16','QF','SF','F'], mr.round) as round_ix
    from public.match_results mr
    where mr.tournament_id = t_id
      and mr.score is distinct from 'BYE'
  ),

  preds as (
    select p.id, p.user_id, p.picks, p.locked_picks, p.points_earned
    from public.predictions p
    where p.tournament_id = t_id
      and p.challenge_id is null
  ),

  -- Every pick, expanded. `picks` is external_match_id -> picked winner's
  -- external id, so this is one row per bracket per filled slot.
  picks as (
    select
      p.id    as prediction_id,
      e.key   as emid,
      e.value as picked_id
    from preds p
    cross join lateral jsonb_each_text(p.picks) as e(key, value)
    where not (coalesce(p.locked_picks, '[]'::jsonb) @> to_jsonb(e.key))
      and e.value in (select pid from cast_ids)
  ),

  -- Picks landing on a match that was actually played. The join IS the filter:
  -- a pick for a slot with no result (a round its player never reached) is
  -- absent from here but still present in `picks`, which is exactly the
  -- popularity-counts-void-picks / accuracy-does-not split described above.
  scored as (
    select
      pk.prediction_id,
      pk.picked_id,
      r.id       as mrid,
      r.round,
      r.round_ix,
      (pk.picked_id = r.winner_external_id) as is_correct
    from picks pk
    join res r on r.external_match_id = pk.emid
  ),

  totals as (
    select
      (select count(*) from preds)  as bracket_count,
      (select count(*) from res)    as match_count,
      (select count(*) from picks)  as picks_made,
      (select coalesce(sum(pl.points), 0)
         from public.point_ledger pl
         join public.predictions p2 on p2.id = pl.prediction_id
        where pl.tournament_id = t_id and p2.challenge_id is null) as points_awarded,
      -- Same exclusion list as count_challenges_by_tournament (034), so the
      -- recap and the card's own challenge badge cannot print different numbers
      -- for the same tournament.
      (select count(*) from public.challenges c
        where c.tournament_id = t_id
          and c.status not in ('cancelled', 'expired', 'declined')) as challenge_count
  ),

  -- ── Per-match consensus ────────────────────────────────────────────────────
  match_stats as (
    select
      s.mrid, s.round, s.round_ix,
      count(*)                             as picks_on_match,
      count(*) filter (where s.is_correct) as called_it
    from scored s
    group by s.mrid, s.round, s.round_ix
  ),

  -- The most-picked player in each match, right or wrong. Feeds both the crowd
  -- bracket and the chalk/chaos count.
  majority as (
    select distinct on (z.mrid)
      z.mrid, z.picked_id, z.cnt
    from (
      select s.mrid, s.picked_id, count(*) as cnt
      from scored s
      group by s.mrid, s.picked_id
    ) z
    -- Deterministic tie-break so rebuilding unchanged data produces an
    -- identical payload. An arbitrary winner would make the recap flicker
    -- between rebuilds for no reason a reader could see.
    order by z.mrid, z.cnt desc, z.picked_id
  ),

  match_consensus as (
    select
      ms.mrid, ms.round, ms.round_ix, ms.picks_on_match, ms.called_it,
      m.picked_id                          as majority_pick,
      m.cnt                                as majority_count,
      (m.picked_id = r.winner_external_id) as majority_right,
      r.winner_external_id, r.loser_external_id, r.score
    from match_stats ms
    join majority m on m.mrid = ms.mrid
    join res r      on r.id   = ms.mrid
  ),

  -- ── Player-level aggregates ────────────────────────────────────────────────

  -- Where each player's run ended. Absent from `lost` entirely means they never
  -- lost: the champion. First loss wins, mirroring eliminationRounds() in
  -- src/lib/tennis/my-tournament.ts, so a stray duplicate result cannot push an
  -- exit later than it actually happened.
  lost as (
    select distinct on (r.loser_external_id)
      r.loser_external_id as pid, r.round as exit_round, r.round_ix as exit_ix
    from res r
    where r.loser_external_id is not null
    order by r.loser_external_id, r.round_ix asc
  ),

  reached as (
    select pid, max(round_ix) as best_ix
    from (
      select winner_external_id as pid, round_ix from res where winner_external_id is not null
      union all
      select loser_external_id  as pid, round_ix from res where loser_external_id  is not null
    ) s
    group by pid
  ),

  -- Each player's first appearance — the one moment every player in the draw
  -- gets exactly once. Backing measured here is comparable across players;
  -- backing measured over the whole tournament is not, because reaching the
  -- final hands you seven chances to be picked and losing in round one hands
  -- you one.
  first_match as (
    select distinct on (s.pid)
      s.pid, s.mrid
    from (
      select winner_external_id as pid, id as mrid, round_ix from res where winner_external_id is not null
      union all
      select loser_external_id  as pid, id as mrid, round_ix from res where loser_external_id  is not null
    ) s
    order by s.pid, s.round_ix asc, s.mrid
  ),

  first_backing as (
    select
      fm.pid,
      coalesce(pc.backers, 0) as backers,
      ms.picks_on_match       as sample,
      round(coalesce(pc.backers, 0)::numeric * 100 / ms.picks_on_match) as backing_pct
    from first_match fm
    -- Inner join: match_stats only holds matches somebody picked, and a match
    -- with no picks has an UNDEFINED backing rate, not a zero one. Dropping
    -- those players is the same distinction pct() draws in src/lib/social/data.ts.
    join match_stats ms on ms.mrid = fm.mrid
    left join (
      select s.mrid, s.picked_id, count(*) as backers
      from scored s
      group by s.mrid, s.picked_id
    ) pc on pc.mrid = fm.mrid and pc.picked_id = fm.pid
    where ms.picks_on_match > 0
  ),

  -- Raw popularity across the whole tournament, void picks included.
  player_picks as (
    select picked_id as pid, count(*) as pick_count, count(distinct prediction_id) as bracket_count
    from picks
    group by picked_id
  ),

  -- Points attributed to the player who WON the match, never to the pick that
  -- sits in the bracket today. Brackets stay editable mid-tournament, so a
  -- ledger row can outlive the pick that earned it; the match winner is the
  -- only stable attribution.
  player_points as (
    select r.winner_external_id as pid, sum(pl.points) as points, count(*) as scoring_picks
    from public.point_ledger pl
    join public.predictions p2 on p2.id = pl.prediction_id
    join res r on r.id = pl.match_result_id
    where pl.tournament_id = t_id and p2.challenge_id is null
    group by r.winner_external_id
  ),

  -- The final's slot holds every bracket's declared champion: whoever they
  -- wrote into the last match, whether or not that player was still standing.
  final_match as (
    select id, external_match_id, winner_external_id, loser_external_id, score
    from res where round = 'F' limit 1
  ),

  champion_picks as (
    select pk.picked_id as pid, count(*) as backers
    from picks pk
    join final_match f on f.external_match_id = pk.emid
    group by pk.picked_id
  ),

  champion_total as (select coalesce(sum(backers), 0) as n from champion_picks),

  -- ── Per-bracket aggregates ────────────────────────────────────────────────
  bracket_correct as (
    select prediction_id, count(*) filter (where is_correct) as correct
    from scored
    group by prediction_id
  ),

  bracket_round as (
    select prediction_id, round, round_ix, count(*) filter (where is_correct) as correct
    from scored
    group by prediction_id, round, round_ix
  ),

  -- The wisdom-of-the-crowd bracket: take the majority pick in every match,
  -- assemble them into one bracket, count how many it called right.
  --
  -- Scored by CORRECT PICKS, not by points. Points would mean reimplementing
  -- calculateStreakMultiplier() from src/lib/tennis/points.ts in SQL, and a
  -- second implementation of the scoring rules is a divergence waiting to
  -- happen — the recap would quietly start disagreeing with the ledger the
  -- first time the multiplier changed. Correct picks need no second
  -- implementation and support the same claim.
  crowd as (
    select count(*) filter (where majority_right) as correct, count(*) as decided
    from match_consensus
  ),

  crowd_rank as (
    select
      (select correct from crowd) as crowd_correct,
      (select count(*) from bracket_correct bc where bc.correct < (select correct from crowd)) as beaten,
      (select count(*) from bracket_correct) as field
  )

select jsonb_strip_nulls(jsonb_build_object(

  'version', 1,
  'built_at', now(),

  -- ── Participation ────────────────────────────────────────────────────────
  'participation', (
    select jsonb_build_object(
      'brackets',       t.bracket_count,
      'matches',        t.match_count,
      'picks_made',     t.picks_made,
      'points_awarded', t.points_awarded,
      'challenges',     t.challenge_count
    ) from totals t
  ),

  -- ── Player narratives ────────────────────────────────────────────────────

  -- Every bracket's declared champion, most-backed first.
  'crowd_favourite', (
    select jsonb_build_object(
      'player',    public.player_json(cp.pid),
      'backers',   cp.backers,
      'sample',    ct.n,
      'was_right', (cp.pid = f.winner_external_id)
    )
    from champion_picks cp, champion_total ct, final_match f
    order by cp.backers desc, cp.pid
    limit 1
  ),

  -- The literal "picked the most": how many pick slots across the tournament
  -- named this player. Reaching the final gives you seven chances to appear
  -- here and losing in round one gives you one, so this rewards deep runs as
  -- much as popularity — which is why `crowd_favourite` above, measured on a
  -- single slot every bracket fills, is the headline and this is the footnote.
  'most_picked', (
    select jsonb_build_object(
      'player',   public.player_json(pp.pid),
      'picks',    pp.pick_count,
      'brackets', pp.bracket_count
    )
    from player_picks pp
    order by pp.pick_count desc, pp.pid
    limit 1
  ),

  -- The literal "picked the least", measured at first appearance so it states
  -- something about belief rather than about how early someone went out.
  'least_picked', (
    select jsonb_build_object(
      'player',      public.player_json(fb.pid),
      'backers',     fb.backers,
      'sample',      fb.sample,
      'backing_pct', fb.backing_pct
    )
    from first_backing fb
    order by fb.backing_pct asc, fb.backers asc, fb.pid
    limit 1
  ),

  'points_machine', (
    select jsonb_build_object(
      'player',        public.player_json(pm.pid),
      'points',        pm.points,
      'scoring_picks', pm.scoring_picks
    )
    from player_points pm
    order by pm.points desc, pm.pid
    limit 1
  ),

  -- Most-backed champion who did not get there, weighted by how far short they
  -- fell. The weighting is what keeps the runner-up out of it: they reached the
  -- final, so their shortfall is zero and their score is zero no matter how
  -- many people backed them.
  'biggest_bust', (
    select jsonb_build_object(
      'player',     public.player_json(cp.pid),
      'backers',    cp.backers,
      'sample',     ct.n,
      'exit_round', l.exit_round
    )
    from champion_picks cp
    join lost l on l.pid = cp.pid
    cross join champion_total ct
    cross join final_match f
    where cp.pid <> f.winner_external_id
    order by (cp.backers * (7 - l.exit_ix)) desc, cp.backers desc, cp.pid
    limit 1
  ),

  -- Nobody's pick, everybody's problem: the least-backed player to reach the
  -- quarterfinals. round_ix 5 is QF in the array at the top of `res`.
  'dark_horse', (
    select jsonb_build_object(
      'player',      public.player_json(fb.pid),
      'backing_pct', fb.backing_pct,
      'backers',     fb.backers,
      'sample',      fb.sample,
      'reached',     case when lo.pid is null then 'W' else lo.exit_round end
    )
    from first_backing fb
    join reached rc on rc.pid = fb.pid
    left join lost lo on lo.pid = fb.pid
    where rc.best_ix >= 5
    order by fb.backing_pct asc, fb.backers asc, fb.pid
    limit 1
  ),

  -- ── Community performance ────────────────────────────────────────────────

  'accuracy', (
    select case when count(*) = 0 then null
      else jsonb_build_object(
        'decided', count(*),
        'correct', count(*) filter (where is_correct),
        'pct',     round(count(*) filter (where is_correct)::numeric * 100 / count(*))
      ) end
    from scored
  ),

  -- The full per-round table. Rounds are reported side by side and never ranked
  -- against each other by raw accuracy: pick rates fall structurally as a
  -- tournament progresses, because calling a quarterfinal means having had the
  -- winner survive three earlier rounds. Real Wimbledon QFs land at 0-9% across
  -- the board, so "hardest round" read straight off these numbers would be a
  -- synonym for "latest round".
  'rounds', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'round',   z.round,
             'decided', z.decided,
             'correct', z.correct,
             'pct',     round(z.correct::numeric * 100 / z.decided)
           ) order by z.round_ix), '[]'::jsonb)
    from (
      select round, round_ix, count(*) as decided, count(*) filter (where is_correct) as correct
      from scored
      group by round, round_ix
    ) z
  ),

  -- Hardest round, measured against the other rounds rather than against a flat
  -- percentage: the round whose accuracy falls furthest below the median round.
  -- That self-normalises the structural drop-off above, so the answer is "the
  -- round that surprised people", not "the last round played".
  'hardest_round', (
    with rs as (
      select round, round_ix, count(*) as decided,
             round(count(*) filter (where is_correct)::numeric * 100 / count(*)) as pct
      from scored group by round, round_ix
    ),
    med as (select percentile_cont(0.5) within group (order by pct) as m from rs)
    select jsonb_build_object(
      'round', rs.round, 'pct', rs.pct, 'decided', rs.decided, 'median_pct', round(med.m)
    )
    from rs, med
    -- Under three rounds there is no spread to deviate from, so there is no
    -- "hardest" worth printing; the round table above still shows every round.
    where (select count(*) from rs) >= 3
    order by (rs.pct - med.m) asc, rs.round_ix desc
    limit 1
  ),

  -- How often the crowd's majority pick lost. The one number that says whether
  -- this was a predictable fortnight or a bloodbath.
  'chalk_vs_chaos', (
    select case when count(*) = 0 then null
      else jsonb_build_object(
        'decided',   count(*),
        'upsets',    count(*) filter (where not majority_right),
        'upset_pct', round(count(*) filter (where not majority_right)::numeric * 100 / count(*))
      ) end
    from match_consensus
  ),

  -- The result the fewest people saw coming. Ties break toward the later round,
  -- where being alone is the stronger claim.
  'bracket_buster', (
    select jsonb_build_object(
      'winner',    public.player_json(mc.winner_external_id),
      'loser',     public.player_json(mc.loser_external_id),
      'round',     mc.round,
      'score',     mc.score,
      'called_it', mc.called_it,
      'sample',    mc.picks_on_match,
      'pct',       round(mc.called_it::numeric * 100 / mc.picks_on_match)
    )
    from match_consensus mc
    order by (mc.called_it::numeric / mc.picks_on_match) asc, mc.round_ix desc
    limit 1
  ),

  -- Maximum consensus, maximum wrongness.
  'unanimous_and_wrong', (
    select jsonb_build_object(
      'winner',       public.player_json(mc.winner_external_id),
      'loser',        public.player_json(mc.loser_external_id),
      'round',        mc.round,
      'score',        mc.score,
      'backed_loser', mc.majority_count,
      'sample',       mc.picks_on_match,
      'pct',          round(mc.majority_count::numeric * 100 / mc.picks_on_match)
    )
    from match_consensus mc
    where not mc.majority_right
    order by (mc.majority_count::numeric / mc.picks_on_match) desc, mc.round_ix desc
    limit 1
  ),

  -- ── The people ───────────────────────────────────────────────────────────

  'podium', (
    select coalesce(jsonb_agg(jsonb_build_object('username', u.username, 'points', p.points_earned)
                    order by p.points_earned desc, u.username), '[]'::jsonb)
    from (
      select user_id, points_earned from preds where points_earned > 0
      order by points_earned desc limit 3
    ) p
    join public.users u on u.id = p.user_id
  ),

  'champion_callers', (
    select jsonb_build_object(
      'callers', coalesce(cp.backers, 0),
      'sample',  ct.n,
      'pct',     case when ct.n = 0 then null
                      else round(coalesce(cp.backers, 0)::numeric * 100 / ct.n) end,
      'player',  public.player_json(f.winner_external_id)
    )
    from final_match f
    cross join champion_total ct
    left join champion_picks cp on cp.pid = f.winner_external_id
  ),

  'best_round', (
    select jsonb_build_object(
      'username', u.username,
      'round',    br.round,
      'correct',  br.correct,
      'decided',  (select count(*) from res r where r.round = br.round)
    )
    from bracket_round br
    join preds p on p.id = br.prediction_id
    join public.users u on u.id = p.user_id
    where br.correct > 0
    order by br.correct desc, br.round_ix desc, u.username
    limit 1
  ),

  'crowd_bracket', (
    select case when cr.field = 0 or c.decided = 0 then null
      else jsonb_build_object(
        'correct',    cr.crowd_correct,
        'decided',    c.decided,
        'beaten',     cr.beaten,
        'field',      cr.field,
        'percentile', round(cr.beaten::numeric * 100 / cr.field)
      ) end
    from crowd_rank cr, crowd c
  )

))
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Both are service-role only. build_tournament_recap reads every user's picks
-- and points, so it must never be reachable from a session — the READ surface
-- for end users is the tournament_recaps table and its public select policy,
-- which exposes the aggregate and nothing else.
revoke all on function public.build_tournament_recap(uuid) from public, anon, authenticated;
grant execute on function public.build_tournament_recap(uuid) to service_role;

revoke all on function public.player_json(text) from public, anon, authenticated;
grant execute on function public.player_json(text) to service_role;

comment on function public.build_tournament_recap(uuid) is
  'Computes the end-of-tournament recap payload. Expands every global bracket''s picks, so call once at completion and store the result in tournament_recaps.';

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- The pick expansion reads every global bracket for one tournament, so the
-- driving lookup is predictions(tournament_id) filtered to challenge_id null.
create index if not exists idx_predictions_tournament_global
  on public.predictions (tournament_id)
  where challenge_id is null;

-- match_results is joined by external_match_id per tournament throughout.
create index if not exists idx_match_results_tournament_emid
  on public.match_results (tournament_id, external_match_id);
