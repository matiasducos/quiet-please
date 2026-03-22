-- Migration: 023_recalculate_league_points
-- Creates a function to recalculate league_members.total_points from actual
-- prediction data, respecting each league's allowed_tournament_types.
-- Also runs an immediate recalculation to fix drifted values.

-- ── 1. Reusable recalculation function ──────────────────────────────────────
create or replace function public.recalculate_league_points()
returns void
language plpgsql
security definer
as $$
begin
  update public.league_members lm
  set total_points = coalesce((
    select sum(p.points_earned)
    from public.predictions p
    join public.tournaments t on t.id = p.tournament_id
    join public.leagues l on l.id = lm.league_id
    where p.user_id = lm.user_id
      and p.challenge_id is null
      and p.points_earned > 0
      and (
        l.allowed_tournament_types is null
        or t.category = any(l.allowed_tournament_types)
      )
  ), 0);
end;
$$;

-- ── 2. Run immediate recalculation to fix current data ──────────────────────
select public.recalculate_league_points();
