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

select case when count(*)=0 then '=== ALL ASSERTIONS PASSED ==='
            else '=== ' || count(*) || ' FAILURE(S) ===' end as result from _failures;
select label as failed from _failures;
