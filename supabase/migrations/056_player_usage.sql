-- Migration: 056_player_usage
-- Reports where a player is referenced, so the admin delete confirmation can say
-- what it is about to remove.
--
-- Players are not protected by foreign keys: draws embed a *snapshot* of each
-- player inside bracket_data.matches[].player1/player2 ({name, country,
-- externalId}), and match_results store winner_external_id / loser_external_id
-- as plain text. Deleting a registry row therefore does not break existing
-- draws or results — they keep their own copy — but the admin should still see
-- whether the player is currently in play.
--
-- This lives in SQL because PostgREST cannot express containment against a JSON
-- path (`bracket_data->matches`); the equivalent client-side check would mean
-- pulling every draw's bracket_data into Node on each delete.

create or replace function public.player_usage(p_external_id text)
returns table (
  draw_count    bigint,
  result_count  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      -- @> on a JSONB array matches an element that *contains* the fragment, so
      -- a partial {"player1":{"externalId":…}} matches the full player object.
      select count(*)
      from public.draws d
      where d.bracket_data -> 'matches' @>
              jsonb_build_array(jsonb_build_object('player1', jsonb_build_object('externalId', p_external_id)))
         or d.bracket_data -> 'matches' @>
              jsonb_build_array(jsonb_build_object('player2', jsonb_build_object('externalId', p_external_id)))
    ) as draw_count,
    (
      select count(*)
      from public.match_results mr
      where mr.winner_external_id = p_external_id
         or mr.loser_external_id  = p_external_id
    ) as result_count;
$$;

-- Admin-only: called through the service-role client.
revoke all on function public.player_usage(text) from public, anon, authenticated;
grant execute on function public.player_usage(text) to service_role;

-- Supports the containment scan above. Indexing the expression (not the whole
-- column) keeps the index to the matches array we actually query.
create index if not exists idx_draws_bracket_matches_gin
  on public.draws using gin ((bracket_data -> 'matches') jsonb_path_ops);

create index if not exists idx_match_results_winner_external_id
  on public.match_results (winner_external_id);

create index if not exists idx_match_results_loser_external_id
  on public.match_results (loser_external_id);
