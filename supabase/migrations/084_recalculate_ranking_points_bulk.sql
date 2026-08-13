-- Migration 084: set-based ranking recalculation
--
-- recalculate_ranking_points(uuid) is the single heaviest workload in this
-- database. pg_stat_statements, never reset since the project was created,
-- puts it at 3,452 calls and 56.6 seconds of execution time — more than any
-- other statement, and roughly half of what the award-points cron spends
-- inside its 60-second limit.
--
-- Nothing is wrong with the function. The problem is the call pattern: both
-- callers loop over users and invoke it once each, so scoring 18 users costs
-- 18 round trips and 36 statements (one aggregate, one UPDATE) to touch 18
-- rows. The work is inherently set-shaped and was being done one row at a
-- time. At 10k users the loop is the whole runtime.
--
-- This adds a bulk entry point. The per-user function is deliberately KEPT:
-- 051 calls it from SQL, the test-tournaments sandbox calls it per user, and
-- a single-user recalculation after one bracket changes is a legitimate,
-- cheaper call than building an array of one. Bulk is for the fan-outs.
--
-- ── Semantics are identical to the per-user version, deliberately ──────────
--
-- Three details carried over exactly, because ranking_points is user-visible
-- and a silent drift here would be very hard to notice:
--
--   1. The join to tournaments stays INNER. A prediction whose tournament is
--      missing contributes to nothing — same as before. The FK makes this
--      unreachable today; preserving it means this function cannot become the
--      reason that changes.
--
--   2. The rolling columns keep the expiry FILTER (081's edition-based
--      expiry), and total_points stays the unfiltered all-time figure that
--      079 revived. Same four expressions, same order.
--
--   3. A user with NO qualifying predictions must be zeroed, not skipped.
--      The per-user function does this for free — coalesce() over an empty
--      aggregate returns 0 and the UPDATE always runs. A plain GROUP BY here
--      would produce no row for that user and leave a stale ranking behind,
--      which is exactly the bug this shape invites. Hence the driving
--      `targets` CTE and the LEFT JOIN: every id passed in gets written,
--      whether or not it has points.
--
-- Returns the number of user rows updated, so a caller can assert it got what
-- it asked for rather than trusting a void.

create or replace function public.recalculate_ranking_points_bulk(p_user_ids uuid[])
returns integer language plpgsql security definer as $$
declare
  _updated integer;
begin
  -- array_length is NULL (not 0) for an empty array, so both are checked.
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  with targets as (
    -- distinct: a caller passing the same id twice must not make the UPDATE
    -- ambiguous about which aggregate row wins.
    select distinct unnest(p_user_ids) as user_id
  ),
  per_user as (
    select
      p.user_id,
      coalesce(sum(p.points_earned)
        filter (where p.expires_at is null or p.expires_at > now()), 0)::int as total,
      coalesce(sum(case when t.tour = 'ATP' then p.points_earned else 0 end)
        filter (where p.expires_at is null or p.expires_at > now()), 0)::int as atp,
      coalesce(sum(case when t.tour = 'WTA' then p.points_earned else 0 end)
        filter (where p.expires_at is null or p.expires_at > now()), 0)::int as wta,
      coalesce(sum(p.points_earned), 0)::int as alltime
    from public.predictions p
    join public.tournaments t on t.id = p.tournament_id
    where p.user_id = any(p_user_ids)   -- uses idx_predictions_user_id
      and p.challenge_id is null
      and p.points_earned > 0
    group by p.user_id
  )
  update public.users u
  set ranking_points     = coalesce(pu.total, 0),
      atp_ranking_points = coalesce(pu.atp, 0),
      wta_ranking_points = coalesce(pu.wta, 0),
      total_points       = coalesce(pu.alltime, 0)
  from targets tg
  left join per_user pu on pu.user_id = tg.user_id
  where u.id = tg.user_id;

  get diagnostics _updated = row_count;
  return _updated;
end;
$$;

-- Same posture as the other admin-client functions (053-058, 079): reachable
-- by the cron and the admin actions, by nobody holding an anon or user JWT.
-- Rankings are derived data — the only correct way for a client to change them
-- is to score a prediction.
revoke all on function public.recalculate_ranking_points_bulk(uuid[]) from public, anon, authenticated;
grant execute on function public.recalculate_ranking_points_bulk(uuid[]) to service_role;
