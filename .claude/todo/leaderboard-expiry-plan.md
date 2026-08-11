# Plan — make the rolling 52-week window actually expire

Status: **proposed**, not started. Written 2026-08-11.
First real-world deadline: **2027-03-29** (earliest live `expires_at` in prod).

---

## 1. The problem, confirmed against prod

The rolling 52-week ranking is stamped but never applied.

- `predictions.expires_at` is written once by award-points
  (`src/app/api/cron/award-points/route.ts:388`) as `tournament.starts_at + 364 days`,
  only when currently NULL. Never re-stamped.
- `recalculate_ranking_points(user)` (migration 015) sums predictions
  `WHERE expires_at IS NULL OR expires_at > NOW()` and writes
  `users.ranking_points` / `atp_ranking_points` / `wta_ranking_points`.
- That RPC is called from exactly two places: the award-points cron
  (`route.ts:448`, for `Object.keys(globalUserPointsDelta)` — **only users who
  scored in that run**) and one admin action.

So a user's points decay only when they earn new points. A dormant user's
`ranking_points` is frozen at its last value forever. Nothing is time-driven;
nothing watches `expires_at`; `idx_predictions_expires_at` is queried by nothing.

**Leagues have the same freeze.** `recalculate_member_points` really does filter
`t.starts_at >= greatest(season_start_date, now() - interval '52 weeks')`
(migration 032), but it only *runs* on join/create or from the cron for users who
scored. The global `recalculate_league_points()` is called from **nowhere** in app
code. Correct window logic that never gets evaluated.

Prod state as of writing: 951 scoring global predictions, all with `expires_at`
populated, zero NULL. Earliest expiry `2027-03-29`; Roland Garros 2026
(starts `2026-05-24`) expires `2027-05-23`.

### Why award-points is the wrong trigger

1. **It is not scheduled.** `vercel.json` has one cron: `process-deletions`. The
   rest were removed in `176cff2` (Hobby plan = daily only). award-points fires
   when an admin clicks it (`AdminPanel.tsx:187`) or from
   `actions.ts:1311`. Expiry would follow the operator's work rhythm, not the calendar.
2. **It early-returns twice** before any recalc: `route.ts:66` (`!allResults.length`)
   and `route.ts:118` (`!predictions.length`). A sweep next to the existing recalc
   is skipped exactly when there is nothing to score.
3. **The off-season is the worst case.** November 2026 events expire November 2027,
   in the ~6-week gap with no tournaments and therefore no runs. Year-end is when
   the biggest reshuffle should be visible.

Tournament-completion is sparser still, and completion is already an overloaded
trigger (trophies, Perfect Prediction, challenge finalization, invite expiry).

---

## 2. Hard constraint: nothing is ever deleted

**Points must remain inspectable for every historical tournament, forever.**

This is already true at the data layer and the plan must not weaken it:

- `point_ledger` is append-only — one row per scored match result. Never touched.
- `predictions.points_earned` is the per-(user, tournament) total. Never zeroed.
- Expiry affects **only `users.ranking_points`**, which is a derived cache.

Every step below is written so that expiry is a *change to an aggregate*, never a
change to a record. A verification invariant in §7 enforces this.

Consequence for the UI: the leaderboard breakdown drawer must **label** expired
tournaments, not filter them out. (This reverses an earlier suggestion — filtering
would have satisfied header/drawer consistency at the cost of hiding history.)

---

## 3. Design decisions

| Decision | Choice | Why |
|---|---|---|
| Trigger | **Own daily cron** `expire-points` | Time-based rule needs a clock, not a proxy event |
| Idempotency | **Marker column** `predictions.expiry_applied_at` | Work set is O(expiring today), self-heals after a missed run |
| Execution | **One set-based SQL function**, not N RPC calls | See below — the loop does not fit in 60s |
| All-time total | **Revive `users.total_points`** | Column exists, is already selected on the profile page, and is currently dead |
| Read surfaces | **Label expired, never hide** | §2 |

### Why set-based, not a loop

My first sketch was "for each expiring user, call `recalculate_ranking_points`,
plus `recalculate_member_points` per league" in chunks of 50, mirroring
award-points §9. That does not scale here. Expiries arrive in **tournament-sized
batches** — everyone who entered the event that started 364 days ago expires on the
same day. At 10k users a Slam could be ~5000 users × ~2 leagues ≈ 15k round trips,
against `maxDuration = 60`. It would time out, and a timeout mid-sweep leaves the
board half-decayed.

One set-based statement per table does the same work in a single round trip, and
matches the existing convention of putting heavy per-user aggregates in Postgres
functions (`user_round_stats`, `user_player_stats`, `scoring_status`).

---

## 4. Migration `079_apply_point_expiry.sql`

> Numbering assumes 079 is next; confirm against CLAUDE.md at write time and bump
> the "latest migration" line there. Migrations run by hand in the dashboard.

**A. Marker column + partial index**

```sql
alter table public.predictions
  add column if not exists expiry_applied_at timestamptz;

-- Partial index: only rows still awaiting a sweep. Stays tiny forever.
create index if not exists idx_predictions_pending_expiry
  on public.predictions (expires_at)
  where expiry_applied_at is null;
```

**B. `apply_point_expiry(p_as_of, p_dry_run, p_limit)`**

Signature:

```sql
create or replace function public.apply_point_expiry(
  p_as_of   timestamptz default now(),
  p_dry_run boolean     default false,
  p_limit   int         default 5000
) returns table (users_updated int, predictions_marked int, sample jsonb)
```

Body, in order:

1. Select the batch into a temp table:
   `id, user_id from predictions where expires_at < p_as_of and expiry_applied_at is null
    and challenge_id is null and points_earned > 0 limit p_limit`
2. Distinct `user_id` set from that batch.
3. **One** `update public.users u set ranking_points = …, atp_ranking_points = …,
   wta_ranking_points = … from (aggregate) agg where u.id = agg.user_id` — the
   aggregate must be a LEFT JOIN over the *user set* with `coalesce(..., 0)`, so a
   user whose only prediction just expired correctly lands on **0** rather than
   being skipped for having no surviving rows.
4. **One** `update public.league_members` for the same users, reusing the exact
   window predicate from migration 032 (`greatest(season_start_date, now() - 52 weeks)`,
   plus the `allowed_tournament_types` / `allowed_surfaces` filters). Do not
   re-derive it — copy it, and add a comment pointing at 032 so the two stay linked.
5. `update predictions set expiry_applied_at = p_as_of where id in (batch)`
6. Return counts + a small `sample` jsonb of before/after for the first ~10 users,
   for the admin summary and for dry-run inspection.

If `p_dry_run` is true: compute steps 1–4 and return the counts and sample, but
**write nothing** (no user update, no league update, no marker stamp).

`p_as_of` exists so the sweep can be dry-run against a future date — see §7. It is
also what makes this testable before 2027-03-29.

`SECURITY DEFINER`, granted to `service_role` only, per the existing convention for
these functions — call it with the admin client.

**C. Extend `recalculate_ranking_points` to maintain `total_points`**

Add to the same UPDATE, computed with **no expiry filter**:

```sql
total_points = (all-time sum of points_earned where challenge_id is null and points_earned > 0)
```

This gives an always-correct all-time figure maintained for free by every existing
call site, and revives a column that has been stuck at 0 in prod since migration 007
zeroed it. Backfill it for all users at the end of the migration.

Note the scoping: `challenge_id is null` is load-bearing — challenge brackets must
never count toward profile-level figures.

---

## 5. The cron route

`src/app/api/cron/expire-points/route.ts`, modeled directly on `process-deletions`
(same auth shape, same `maxDuration = 60`, same `withCronLogging` wrapper — which
also gives the concurrency guard and a `cron_runs` row).

```
GET /api/cron/expire-points[?dry=1][&as_of=ISO]
```

- Auth: `Bearer CRON_SECRET`, dev bypass, identical to `process-deletions`.
- Calls `apply_point_expiry` in a loop until it returns `predictions_marked = 0` or
  a wall-clock budget (~45s) is hit, so a very large batch drains across runs
  instead of timing out. The marker makes resuming free.
- `?dry=1` passes `p_dry_run` through and writes nothing.
- Returns `{ users_updated, predictions_marked, batches }` so the summary is
  visible in the admin **Cron Runs** tab — that tab renders whatever `job_name`
  rows exist, so no admin UI change is needed.

**Schedule** — add to `vercel.json`:

```json
{ "path": "/api/cron/expire-points", "schedule": "0 4 * * *" }
```

04:00, an hour after `process-deletions`, so they never contend.

⚠️ **Verify the Hobby cron limit before merging.** This would be the second
scheduled cron. If Hobby caps at 2 we are exactly at the limit and any future cron
forces the Pro upgrade already noted in `docs/handoff.md:222`. If it caps at 1, the
fallback is to call `apply_point_expiry` at the *top* of `process-deletions`
(before its own early return) — ugly coupling, but it preserves the daily clock,
which is the property that actually matters.

---

## 6. Read surfaces that must change with it

Otherwise the numbers visibly disagree the day the first sweep runs.

**a. Leaderboard breakdown drawer** — `buildStats` in `src/app/leaderboard/page.tsx:236`
selects `.gt('points_earned', 0)` with **no** `expires_at` condition. Post-fix the
header would read 0 while the drawer still lists "🇫🇷 Roland Garros — 1000 pts".

Per §2, the fix is **not** to filter. Select `expires_at` alongside, and mark
entries where `expires_at < now()` as no longer counting toward the rolling total
(styling/label TBD — UI to be discussed separately). The row stays visible forever.

**b. Achievements** — `src/lib/achievements/check.ts:329` does
`const lifetime = u?.ranking_points ?? 0` and gates `points_vault` / `legend` /
`hall_of_fame` at 10k/25k/50k. Once decay works, those silently become
rolling-peak thresholds and stop matching their own names. Point them at the
revived `total_points` instead. Already-awarded rows are never revoked — that stays.

**c. `test-tournaments`** — `src/app/test-tournaments/actions.ts:50-58,175` writes
`users.total_points` with hand-rolled `+/-` arithmetic. Once the RPC owns that
column the sandbox's writes are clobbered on the next recalc. Replace the arithmetic
with `recalculate_ranking_points` / `recalculate_member_points` calls so there is one
authority. Admin-gated sandbox, contained change.

**d. Caching** — the leaderboard's `unstable_cache` slots (`revalidate: 60`/`300`)
self-heal within 5 minutes of a sweep. No change needed.

---

## 7. Verification

The migration is a **no-op until 2027-03-29** — nothing in prod is expired yet. So
correctness cannot be established by running it and looking. Per
`verify-sql-against-real-rows`, a parse check and a logic sim both passing while the
query is silently wrong is the known failure mode here.

1. **Throwaway Docker Postgres, hand-computed fixture.** Load the schema, build a
   handful of users covering: only-expired (must land on exactly 0), mixed
   expired/live, all-live, expired-with-challenge-rows (must be ignored),
   ATP-only / WTA-only / both, and a league member with
   `allowed_surfaces` / `allowed_tournament_types` set. Assert each computed total
   against a number worked out by hand, not by re-running the same SQL.
2. **Permanence invariant** — before/after every fixture run:
   `count(*) from point_ledger` unchanged, and
   `sum(points_earned) from predictions` unchanged. This is the §2 guarantee
   expressed as a test; it must be in the harness, not just the review.
3. **Correctness invariant over real rows** — restore a prod snapshot, run with
   `p_as_of = '2027-07-01'`, then assert for every user:
   `ranking_points = sum(points_earned) where challenge_id is null
    and points_earned > 0 and (expires_at is null or expires_at > p_as_of)`.
4. **Dry-run against prod** with `?dry=1&as_of=2027-06-01` once deployed. Reads
   only. Confirms the real post-Roland-Garros board before any user sees it.
5. Add to `scripts/` alongside `verify-scoring.mjs`, following its shape.

---

## 7b. Expiry notification — DECIDED: in-app only, no email

When a sweep drops a user's points, they get an **in-app notification**. No email —
this is not worth an inbox, and a dormant user is exactly who would read
"your points expired" as a reason to stay gone.

New type `points_expired`. Per the CLAUDE.md checklist, that is 4 places:

1. **DB constraint migration** — re-declare the full `CHECK (type IN (…))` list with
   `points_expired` added. Latest list is in `052_invite_feature.sql:53`; copy it
   forward, do not write a partial list.
2. **The insert** — note this is the one deviation from the usual checklist: the
   insert lives in the **cron route**, not a server action. Emit one row per user
   the sweep actually changed, with `meta` carrying `points_expired`,
   `points_remaining`, and the tournament name + `tournament_flag_emoji`
   (tournament references always carry the flag).
3. **`TYPE_META`** in `src/app/notifications/page.tsx:20` — label "Points expired",
   colour `#993C1D` (the existing muted-red used for the other subtractive events).
4. **`getHref()` + message template** in the same file — link to the user's own
   profile, where the all-time vs. active figure will live.

Batching: one notification per user per sweep, not one per expired tournament. A
Slam expiring can touch thousands of users at once, so the insert must be chunked
the way `announce-draw-open.ts` already does it.

Do **not** emit a notification for a dry run.

---

## 8. Open questions — need a decision

1. ~~Do users get told?~~ **Decided** — in-app notification, no email. See §7b.
2. **What replaces the number?** With `total_points` revived we can show
   "1000 all-time · 0 active" instead of a bare 0. UI to be designed separately —
   the data will be there either way.
3. ~~Flat 364 days, or real ATP semantics?~~ **Decided** — edition-based. See §10.

---

## 10. Edition-based expiry (real ATP semantics)

### The rule being modelled

ATP points don't die on a day count. They die when the **next edition of the same
tournament is played**, and are replaced in the same ranking update by whatever the
player scores in that new edition — the "defending points" mechanic. If the event
isn't held the following year, the points expire at 52 weeks. The flat rule is the
*fallback*, not the primary.

(ATP also counts only a player's best ~19 results. We sum everything. That is a
separate rule and is **not** in scope here.)

### Derive it — do not stamp it

The obvious implementation is to re-stamp `expires_at` whenever a new edition
appears. **Don't.** Imperative re-stamping means every calendar change is a write
that can be missed, and it needs bug-prone compensations: a re-stamp that moves the
date later must resurrect already-expired points, so it must also clear
`expiry_applied_at`, and a re-stamp that never fires leaves a stale date forever.

Instead, make the expiry a **derived value**, recomputed by the same daily cron,
with `predictions.expires_at` kept as a materialized cache so read paths stay O(1).
Recomputing from scratch each day makes resurrection automatic and deletes that
entire class of bug.

For a prediction on edition E, with `flat_364 = E.starts_at + interval '364 days'`
and `next_ed` = the earliest edition of the same **(series_id, tour)** with
`starts_year > E.starts_year`:

```
effective_expiry =
  -- 1. Next edition has been played → swap at its completion
  when next_ed.completed_at is not null
    then next_ed.completed_at

  -- 2. Next edition exists but hasn't concluded → hold the points through it,
  --    but never past the safety cap
  when next_ed.id is not null
    then least(
      greatest(flat_364, next_ed.ends_at + interval '3 days'),
      flat_364 + interval '60 days'
    )

  -- 3. No next edition → the 52-week fallback, which is also the ATP rule
  else flat_364
```

Match on `(series_id, tour)`, which is exactly the unique index from
`072_tournament_series.sql:106`. A series is deliberately tour-agnostic — Wimbledon
is one series with an ATP edition and a WTA edition — so matching on `series_id`
alone would cross-expire the two tours.

Branch 2 is what prevents the gap when an edition shifts *later* than the
anniversary: `greatest` holds the points until the new event resolves rather than
retiring them into an empty window. Branch 1 then fires on completion, which may be
*earlier* than `flat_364` when an edition shifts earlier — that is the double-count
the flat rule gets wrong.

**The `+ 60 days` cap in branch 2 is the safety valve.** See below.

### "What if a tournament disappears?" — you should not have to tell it

Because the value is derived rather than stamped, every disappearance case resolves
itself from the state of the `tournaments` table:

| What happens | Signal needed? | Outcome |
|---|---|---|
| Cancelled, never returns | **No** | No later edition row → branch 3 → expires at 52 weeks, which is the correct ATP behaviour |
| Scheduled, then cancelled, row deleted via `deleteTournament` | **No** | Derivation re-reads and falls back to branch 3 next sweep |
| Scheduled, then quietly dropped, row left in `upcoming` forever | **No** | Branch 2's cap fires at `flat_364 + 60d` |
| Returns later than the anniversary | **No** | Branch 2 `greatest` extends the window |
| Returns earlier than the anniversary | **No** | Branch 1 swaps at completion |
| Renamed / new title sponsor | **No** | Series identity is independent of `tournaments.name` — the whole reason 072 exists |
| Moves city, changes surface | **No** | Same `series_id` |
| Sync auto-creates a duplicate series for the same event | Ideally review it in `/admin/tournaments/series` | Otherwise the next edition isn't found and it expires at 52 weeks — degraded, not wrong |

The third row is the one that would break a stamped design and is the reason for the
cap: a phantom edition sitting in `upcoming` forever would otherwise suppress expiry
indefinitely. With the cap, the worst case of *any* unsignalled disappearance is
that points live at most 60 days too long, then expire on their own.

### Two schema gaps this depends on

1. **`tournaments.completed_at` does not exist.** No migration defines it. Branch 1
   needs a real timestamp for when the edition was played. Add the column and stamp
   it where status flips to `completed` — already a well-defined trigger point in
   the admin results flow. Backfill from the last `match_results.scored_at` per
   tournament.
2. **There is no `cancelled` status.** The constraint
   (`009_draw_published_status.sql:16`) allows only `upcoming`, `draw_published`,
   `accepting_predictions`, `in_progress`, `completed`, so a dropped event is either
   hard-deleted or left in limbo. The cap makes this survivable, but adding
   `cancelled` and excluding those rows from `next_ed` would make intent explicit
   rather than relying on a timeout. **Recommended, not required.**

### Sequencing

Build §4–§7 first. The sweep applies whatever `expires_at` says, so it is
independent of this rule and can ship while the calendar question is still settling.
This section then changes only how `expires_at` is computed — and, because it is
derived, is safe to turn on retroactively.

## 11. Explicitly out of scope

- ATP/WTA "best N results" counting. We sum everything; that is a separate rule.
- Any UI beyond the minimum needed for the numbers to stop contradicting each
  other (§6a); the historical-points UI is a separate discussion.
- Backfilling or altering any historical points data. Nothing is deleted.
