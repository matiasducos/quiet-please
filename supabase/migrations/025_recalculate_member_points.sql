-- Migration: 025_recalculate_member_points
-- Targeted function to recalculate a single member's points in a single league.
-- Called on join/create instead of the global recalculate_league_points().

create or replace function public.recalculate_member_points(
  p_league_id uuid,
  p_user_id uuid
)
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
  ), 0)
  where lm.league_id = p_league_id
    and lm.user_id = p_user_id;
end;
$$;
