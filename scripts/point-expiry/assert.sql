create or replace function ok(label text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is not distinct from want then
    raise notice 'PASS  % (=%)', label, got;
  else
    raise notice 'FAIL  %  got=%  want=%', label, got, want;
    insert into _failures values (label);
  end if;
end $$;
create table _failures(label text);

-- ── Baseline for the permanence invariant ────────────────────────────────
create table _baseline as
  select (select count(*) from point_ledger) as ledger_rows,
         (select sum(points_earned) from predictions) as pts_sum;

-- ══ 1. DRY RUN — reports, writes nothing ═════════════════════════════════
create table _dry as select * from apply_point_expiry('2027-06-01'::timestamptz, true, 5000);
do $$ begin
  perform ok('dry: predictions_marked', (select predictions_marked from _dry), 5);
  perform ok('dry: users_updated',      (select users_updated      from _dry), 4);
  perform ok('dry: U1 untouched',       (select ranking_points from users where username='only_expired'), 1000);
  perform ok('dry: U5 untouched',       (select ranking_points from users where username='atp_wta'), 1400);
  perform ok('dry: no rows marked',     (select count(*)::int from predictions where expiry_applied_at is not null), 0);
  perform ok('dry: leagues untouched',  (select total_points from league_members where league_id='44444444-0000-0000-0000-000000000001'), 1400);
end $$;

-- ══ 2. REAL RUN ══════════════════════════════════════════════════════════
create table _run as select * from apply_point_expiry('2027-06-01'::timestamptz, false, 5000);
do $$ begin
  perform ok('run: predictions_marked', (select predictions_marked from _run), 5);
  perform ok('run: users_updated',      (select users_updated      from _run), 4);

  -- U1: sole prediction expired. The LEFT JOIN case — must be 0, not skipped.
  perform ok('U1 total', (select ranking_points     from users where username='only_expired'), 0);
  perform ok('U1 atp',   (select atp_ranking_points from users where username='only_expired'), 0);

  -- U2: 500 expired ATP dropped, 300 live WTA kept
  perform ok('U2 total', (select ranking_points     from users where username='mixed'), 300);
  perform ok('U2 atp',   (select atp_ranking_points from users where username='mixed'), 0);
  perform ok('U2 wta',   (select wta_ranking_points from users where username='mixed'), 300);

  -- U3: nothing expired -> not in the batch -> untouched
  perform ok('U3 total (untouched)', (select ranking_points from users where username='all_live'), 600);

  -- U4: 800-point challenge bracket must be invisible; only the 100 global expired
  perform ok('U4 total (challenge excluded)', (select ranking_points from users where username='challenge_heavy'), 0);

  -- U5: keeps only the two live ones (250 WTA + 150 ATP)
  perform ok('U5 total', (select ranking_points     from users where username='atp_wta'), 400);
  perform ok('U5 atp',   (select atp_ranking_points from users where username='atp_wta'), 150);
  perform ok('U5 wta',   (select wta_ranking_points from users where username='atp_wta'), 250);

  -- Leagues: window is starts_at >= 2027-06-01 - 364d = 2026-06-02, so T3 + T4
  perform ok('L1 U5 (no filter)',  (select total_points from league_members where league_id='44444444-0000-0000-0000-000000000001'), 400);
  -- L2 filters to grass -> T3 only
  perform ok('L2 U5 (grass only)', (select total_points from league_members where league_id='44444444-0000-0000-0000-000000000002'), 250);

  -- Challenge row must not be marked
  perform ok('challenge row unmarked', (select expiry_applied_at from predictions where id='33333333-0000-0000-0000-000000000006'), null::timestamptz);
  perform ok('marked count', (select count(*)::int from predictions where expiry_applied_at is not null), 5);
end $$;

-- ══ 3. IDEMPOTENCE ═══════════════════════════════════════════════════════
create table _run2 as select * from apply_point_expiry('2027-06-01'::timestamptz, false, 5000);
do $$ begin
  perform ok('rerun: nothing left', (select predictions_marked from _run2), 0);
  perform ok('rerun: U5 stable',    (select ranking_points from users where username='atp_wta'), 400);
end $$;

-- ══ 4. PERMANENCE — the hard constraint ══════════════════════════════════
do $$ begin
  perform ok('point_ledger rows unchanged',
    (select count(*) from point_ledger), (select ledger_rows from _baseline));
  perform ok('sum(points_earned) unchanged',
    (select sum(points_earned) from predictions), (select pts_sum from _baseline));
  perform ok('every historical tournament still readable for U1',
    (select points_earned from predictions where user_id='22222222-0000-0000-0000-000000000001'), 1000);
end $$;


-- ══ 5. ALL-TIME TOTAL survives expiry (the §2 constraint, made observable) ══
-- total_points is backfilled by the migration and maintained by
-- recalculate_ranking_points. The sweep must NOT touch it.
do $$ begin
  perform ok('U1 all-time preserved after expiry',
    (select total_points from users where username='only_expired'), 1000);
  perform ok('U5 all-time preserved after expiry',
    (select total_points from users where username='atp_wta'), 1400);
  perform ok('U4 all-time excludes challenge bracket',
    (select total_points from users where username='challenge_heavy'), 100);
end $$;

-- recalculate_ranking_points must agree with the sweep for the rolling columns,
-- and must set the all-time column. Uses now() internally, so at real-world
-- "now" (2026) nothing is expired and rolling == all-time.
do $$ begin
  perform recalculate_ranking_points('22222222-0000-0000-0000-000000000001');
  perform ok('RPC: U1 all-time',    (select total_points   from users where username='only_expired'), 1000);
  perform ok('RPC: U1 rolling@now', (select ranking_points from users where username='only_expired'), 1000);
end $$;


-- ══ 6. completed_at: trigger + backfill ══════════════════════════════════
do $$ begin
  -- Backfill preferred the last scored result over ends_at.
  perform ok('backfill: uses last scored_at',
    (select completed_at from tournaments where id='11111111-0000-0000-0000-000000000001'),
    '2026-04-06T18:00:00Z'::timestamptz);
  -- No results scored -> falls back to ends_at.
  perform ok('backfill: falls back to ends_at',
    (select completed_at from tournaments where id='11111111-0000-0000-0000-000000000004'),
    '2026-09-08'::timestamptz);
  -- Not completed -> stays null.
  perform ok('backfill: skips non-completed',
    (select completed_at from tournaments where id='11111111-0000-0000-0000-000000000008'), null::timestamptz);
end $$;

do $$ begin
  -- Trigger stamps on transition INTO completed...
  update tournaments set status='completed' where id='11111111-0000-0000-0000-000000000008';
  perform ok('trigger: stamps on complete',
    (select completed_at is not null from tournaments where id='11111111-0000-0000-0000-000000000008'), true);
  -- ...and clears on the un-complete path the admin results page provides.
  update tournaments set status='in_progress' where id='11111111-0000-0000-0000-000000000008';
  perform ok('trigger: clears on un-complete',
    (select completed_at from tournaments where id='11111111-0000-0000-0000-000000000008'), null::timestamptz);
  -- Put it back to the phantom state the branch-2 cap test needs.
  update tournaments set status='upcoming' where id='11111111-0000-0000-0000-000000000008';
end $$;

-- ══ 7. refresh_point_expiry — the derived rule ═══════════════════════════
-- Dry run first: must report identically and write nothing.
create table _rdry as select * from refresh_point_expiry('2027-06-01'::timestamptz, true);
do $$ begin
  perform ok('refresh dry: rows_updated', (select rows_updated from _rdry), 8);
  perform ok('refresh dry: resurrected',  (select resurrected  from _rdry), 1);
  perform ok('refresh dry: newly_due',    (select newly_due    from _rdry), 3);
  perform ok('refresh dry: wrote nothing',
    (select expires_at from predictions where id='33333333-0000-0000-0000-000000000009'),
    '2027-05-23'::timestamptz);
end $$;

create table _refresh as select * from refresh_point_expiry('2027-06-01'::timestamptz, false);
do $$ begin
  perform ok('refresh: rows_updated', (select rows_updated from _refresh), 8);
  perform ok('refresh: resurrected',  (select resurrected  from _refresh), 1);
  perform ok('refresh: newly_due',    (select newly_due    from _refresh), 3);

  -- BRANCH 2 + CAP: phantom 2027 edition ends 2027-12-01, but the cap pins
  -- Marrakech at flat_364 + 60d rather than letting it suppress expiry forever.
  perform ok('cap: phantom edition capped at +60d',
    (select expires_at from predictions where id='33333333-0000-0000-0000-000000000001'),
    '2027-05-28'::timestamptz);

  -- BRANCH 2: RG 2027 runs past the anniversary -> hold through it (+3d).
  perform ok('branch 2: held through the new edition',
    (select expires_at from predictions where id='33333333-0000-0000-0000-000000000009'),
    '2027-06-09'::timestamptz);
  perform ok('branch 2: marker cleared so points return',
    (select expiry_applied_at from predictions where id='33333333-0000-0000-0000-000000000009'), null::timestamptz);

  -- BRANCH 1: WTA 2027 already played, earlier than the anniversary -> swap.
  perform ok('branch 1: swaps at completion',
    (select expires_at from predictions where id='33333333-0000-0000-0000-00000000000a'),
    '2027-05-10T12:00:00Z'::timestamptz);

  -- BRANCH 3: no 2027 edition -> flat 364 days, untouched.
  perform ok('branch 3: flat fallback unchanged',
    (select expires_at from predictions where id='33333333-0000-0000-0000-00000000000b'),
    '2027-08-31'::timestamptz);
end $$;

-- ══ 8. Totals after the derived refresh ══════════════════════════════════
-- U5 holds RG (resurrected, 400 ATP) + hard court (150 ATP) = 550; Marrakech and
-- the WTA grass event are both expired.
do $$ begin
  perform ok('U5 total after refresh', (select ranking_points     from users where username='atp_wta'), 550);
  perform ok('U5 atp after refresh',   (select atp_ranking_points from users where username='atp_wta'), 550);
  perform ok('U5 wta after refresh',   (select wta_ranking_points from users where username='atp_wta'), 0);
  -- U2's only live event just became expired.
  perform ok('U2 total after refresh', (select ranking_points from users where username='mixed'), 0);
  -- U3 keeps the hard court event only.
  perform ok('U3 total after refresh', (select ranking_points from users where username='all_live'), 400);
  -- U1's Marrakech points were expired before the refresh and are still expired
  -- after it (2027-03-29 -> capped 2027-05-28, both before as_of), so no flip and
  -- no recompute. The expected value is 1000 rather than 0 because section 5
  -- deliberately called recalculate_ranking_points at real now(), when nothing is
  -- expired — the point of this assertion is that refresh left that value ALONE.
  perform ok('U1 untouched by refresh', (select ranking_points from users where username='only_expired'), 1000);
end $$;

-- ══ 9. Permanence still holds after the derived refresh ══════════════════
do $$ begin
  perform ok('post-refresh: ledger rows unchanged',
    (select count(*) from point_ledger), (select ledger_rows from _baseline));
  perform ok('post-refresh: sum(points_earned) unchanged',
    (select sum(points_earned) from predictions), (select pts_sum from _baseline));
  perform ok('post-refresh: all-time preserved for U5',
    (select total_points from users where username='atp_wta'), 1400);
end $$;

-- ══ 10. Idempotence of refresh ═══════════════════════════════════════════
create table _refresh2 as select * from refresh_point_expiry('2027-06-01'::timestamptz, false);
do $$ begin
  perform ok('refresh rerun: nothing left to change', (select rows_updated from _refresh2), 0);
  perform ok('refresh rerun: U5 stable', (select ranking_points from users where username='atp_wta'), 550);
end $$;


-- ══ 11. calendar_gaps — the admin reminder's detection ═══════════════════
-- Fixture series a/b/c all have a 2027 edition; series d (ATP hard, 2026-09-01,
-- flat expiry 2027-08-31) deliberately does not.
do $$ begin
  -- 90-day window from 2027-06-01 reaches 2027-08-30 — just short of series d.
  perform ok('gaps: 90d window excludes a gap past the horizon',
    (select count(*)::int from calendar_gaps('2027-06-01'::timestamptz, 90)), 0);
  -- 120 days reaches 2027-09-29 and catches it.
  perform ok('gaps: 120d window catches series d',
    (select count(*)::int from calendar_gaps('2027-06-01'::timestamptz, 120)), 1);
  perform ok('gaps: names the series',
    (select series_name from calendar_gaps('2027-06-01'::timestamptz, 120)), 'ATP Hard Series');
  -- Two scoring predictions ride on it (U3 400 + U5 150).
  perform ok('gaps: counts affected predictions',
    (select affected_predictions from calendar_gaps('2027-06-01'::timestamptz, 120)), 2);
  -- Series WITH a next edition must never be reported, even in a wide window.
  perform ok('gaps: series with a next edition excluded',
    (select count(*)::int from calendar_gaps('2027-01-01'::timestamptz, 400)
      where series_name <> 'ATP Hard Series'), 0);
end $$;

select case when count(*)=0 then '=== ALL ASSERTIONS PASSED ==='
            else '=== ' || count(*) || ' FAILURE(S) ===' end as result from _failures;
select label as failed from _failures;
