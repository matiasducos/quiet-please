-- Minimal schema: only what apply_point_expiry touches.
create table users (
  id uuid primary key, username text,
  ranking_points int not null default 0,
  atp_ranking_points int not null default 0,
  wta_ranking_points int not null default 0,
  total_points int not null default 0
);
create table tournaments (
  id uuid primary key, name text, tour text, category text, surface text,
  starts_at timestamptz, ends_at timestamptz,
  status text, starts_year int, series_id uuid, completed_at timestamptz
);
create table match_results (
  id uuid primary key default gen_random_uuid(), tournament_id uuid, scored_at timestamptz
);
create table predictions (
  id uuid primary key, user_id uuid, tournament_id uuid, challenge_id uuid,
  points_earned int not null default 0, expires_at timestamptz
);
create table leagues (
  id uuid primary key, season_start_date timestamptz, created_at timestamptz default now(),
  allowed_tournament_types text[], allowed_surfaces text[]
);
create table league_members (league_id uuid, user_id uuid, total_points int not null default 0);
create table point_ledger (id uuid primary key default gen_random_uuid(), prediction_id uuid, points int);

-- ── Tournaments. as_of for all tests is 2027-06-01.
--    expires_at = starts_at + 364d, stamped explicitly below.
insert into tournaments (id, name, tour, category, surface, starts_at, ends_at, status, starts_year, series_id) values
 ('11111111-0000-0000-0000-000000000001','Marrakech','ATP','250','clay',        '2026-03-30','2026-04-06','completed',2026,'55555555-0000-0000-0000-00000000000a'),
 ('11111111-0000-0000-0000-000000000002','Roland Garros','ATP','grand_slam','clay','2026-05-24','2026-06-07','completed',2026,'55555555-0000-0000-0000-00000000000b'),
 ('11111111-0000-0000-0000-000000000003','Some WTA grass','WTA','500','grass',  '2026-08-01','2026-08-08','completed',2026,'55555555-0000-0000-0000-00000000000c'),
 ('11111111-0000-0000-0000-000000000004','Some ATP hard','ATP','masters_1000','hard','2026-09-01','2026-09-08','completed',2026,'55555555-0000-0000-0000-00000000000d');

-- Scored results, so the completed_at backfill has a real timestamp to find.
insert into match_results (tournament_id, scored_at) values
 ('11111111-0000-0000-0000-000000000001','2026-04-06T18:00:00Z'),
 ('11111111-0000-0000-0000-000000000002','2026-06-07T18:00:00Z');

-- ── 2027 editions, one per branch of the derived rule (as_of = 2027-06-01) ──
insert into tournaments (id, name, tour, category, surface, starts_at, ends_at, status, starts_year, series_id) values
 -- BRANCH 2 + CAP: a phantom edition parked in 'upcoming' with a far-future end.
 -- Uncapped this would push Marrakech's expiry to 2027-12-04 and suppress it
 -- indefinitely; the cap pins it to flat_364 + 60d = 2027-05-28 (still expired).
 ('11111111-0000-0000-0000-000000000008','Marrakech 2027','ATP','250','clay','2027-03-29','2027-12-01','upcoming',2027,'55555555-0000-0000-0000-00000000000a'),
 -- BRANCH 2: real edition running later than the anniversary. Points must be
 -- HELD through it -> 2027-06-06 + 3d = 2027-06-09, past as_of -> RESURRECTED.
 ('11111111-0000-0000-0000-000000000006','Roland Garros 2027','ATP','grand_slam','clay','2027-05-23','2027-06-06','in_progress',2027,'55555555-0000-0000-0000-00000000000b'),
 -- BRANCH 1: edition already played, EARLIER than the anniversary. Swap at its
 -- completion -> 2027-05-10, before as_of -> NEWLY DUE. This is the double-count
 -- the flat 364-day rule got wrong.
 ('11111111-0000-0000-0000-000000000007','WTA grass 2027','WTA','500','grass','2027-05-01','2027-05-08','completed',2027,'55555555-0000-0000-0000-00000000000c');
update tournaments set completed_at = '2027-05-10T12:00:00Z' where id = '11111111-0000-0000-0000-000000000007';
-- BRANCH 3: series 'd' deliberately has NO 2027 edition -> flat 364 days, unchanged.

insert into users (id, username, ranking_points, atp_ranking_points, wta_ranking_points) values
 ('22222222-0000-0000-0000-000000000001','only_expired', 1000, 1000,   0),
 ('22222222-0000-0000-0000-000000000002','mixed',         800,  500, 300),
 ('22222222-0000-0000-0000-000000000003','all_live',      600,  400, 200),
 ('22222222-0000-0000-0000-000000000004','challenge_heavy',900, 900,   0),
 ('22222222-0000-0000-0000-000000000005','atp_wta',      1400, 1150, 250);

-- points_earned, expires_at = tournament starts_at + 364 days
insert into predictions (id, user_id, tournament_id, challenge_id, points_earned, expires_at) values
 -- U1: single expired prediction -> must land on exactly 0 (the LEFT JOIN case)
 ('33333333-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001',null,1000,'2027-03-29'),
 -- U2: one expired (500 ATP), one live (300 WTA) -> 300 / atp 0 / wta 300
 ('33333333-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000001',null, 500,'2027-03-29'),
 ('33333333-0000-0000-0000-000000000003','22222222-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000003',null, 300,'2027-07-31'),
 -- U3: nothing expired -> not in batch at all, must be left untouched
 ('33333333-0000-0000-0000-000000000004','22222222-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000003',null, 200,'2027-07-31'),
 ('33333333-0000-0000-0000-000000000005','22222222-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000004',null, 400,'2027-08-31'),
 -- U4: an expired CHALLENGE bracket (800) + an expired global pred (100).
 --     Challenge row must be invisible both to the batch and to the aggregate -> 0
 ('33333333-0000-0000-0000-000000000006','22222222-0000-0000-0000-000000000004','11111111-0000-0000-0000-000000000002','99999999-0000-0000-0000-000000000001',800,'2027-05-23'),
 ('33333333-0000-0000-0000-000000000007','22222222-0000-0000-0000-000000000004','11111111-0000-0000-0000-000000000001',null, 100,'2027-03-29'),
 -- U5: expired 600 ATP + 400 ATP; live 250 WTA + 150 ATP -> 400 / atp 150 / wta 250
 ('33333333-0000-0000-0000-000000000008','22222222-0000-0000-0000-000000000005','11111111-0000-0000-0000-000000000001',null, 600,'2027-03-29'),
 ('33333333-0000-0000-0000-000000000009','22222222-0000-0000-0000-000000000005','11111111-0000-0000-0000-000000000002',null, 400,'2027-05-23'),
 ('33333333-0000-0000-0000-00000000000a','22222222-0000-0000-0000-000000000005','11111111-0000-0000-0000-000000000003',null, 250,'2027-07-31'),
 ('33333333-0000-0000-0000-00000000000b','22222222-0000-0000-0000-000000000005','11111111-0000-0000-0000-000000000004',null, 150,'2027-08-31');

insert into point_ledger (prediction_id, points)
  select id, points_earned from predictions;

-- L1: no filters. L2: grass only. Both have U5.
insert into leagues (id, season_start_date, allowed_tournament_types, allowed_surfaces) values
 ('44444444-0000-0000-0000-000000000001','2025-01-01', null, null),
 ('44444444-0000-0000-0000-000000000002','2025-01-01', null, '{grass}');
insert into league_members (league_id, user_id, total_points) values
 ('44444444-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000005', 1400),
 ('44444444-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000005', 1400);
