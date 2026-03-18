# Database schema

All tables live in Supabase (PostgreSQL). Row Level Security (RLS) is enabled on all tables.
Schema is built across 9 migrations (see `supabase/migrations/`).

## Tables

### `users`
Extended profile linked to Supabase Auth (`auth.users`). Auto-created by `handle_new_user()` trigger on signup.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Matches `auth.users.id` |
| username | text unique | Public display name |
| email | text | From auth |
| avatar_url | text | Nullable |
| total_points | int | Legacy — do not use in new code |
| ranking_points | int | Rolling 52-week total (ATP + WTA combined) — use this |
| atp_ranking_points | int | Rolling 52-week ATP-only total |
| wta_ranking_points | int | Rolling 52-week WTA-only total |
| username_is_set | bool | False for OAuth users until they complete /setup-username |
| country | text | Nullable — set via profile location form |
| city | text | Nullable — set via profile location form |
| created_at | timestamptz | |

**Key note**: `ranking_points` is computed by the `recalculate_ranking_points(user_id)` SQL function (called by the award-points cron). Do **not** write to it directly. `total_points` is a legacy column kept for compatibility but not used in any current queries.

### `tournaments`
One row per ATP/WTA tournament edition.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| external_id | text unique | ID from the tennis API (or `manual-*` prefix for hand-seeded rows) |
| name | text | e.g. "Wimbledon" |
| tour | text | `ATP` or `WTA` |
| category | text | `grand_slam`, `masters_1000`, `500`, `250` |
| surface | text | `hard`, `clay`, `grass` |
| location | text | e.g. "London, UK" — display only, nullable |
| flag_emoji | text | e.g. "🇬🇧" — nullable |
| draw_close_at | timestamptz | Predictions lock at this time |
| starts_at | timestamptz | |
| ends_at | timestamptz | |
| status | text | `upcoming` → `draw_published` → `accepting_predictions` → `in_progress` → `completed` |

**Status lifecycle**: managed by cron jobs. `sync-backfill` can bulk-advance past tournaments to `completed`. Added in migration `009_draw_published_status.sql`.

| Status | Draw visible? | Players named? | Predictions open? | Matches playing? |
|---|---|---|---|---|
| `upcoming` | No | — | No | No |
| `draw_published` | Yes (bracket shell) | ❌ All null (qualifying week) | No | No |
| `accepting_predictions` | Yes (main draw) | ✅ Named players | ✅ Yes | No |
| `in_progress` | Yes | ✅ Named players | ❌ Locked | ✅ Yes |
| `completed` | Yes | ✅ Named players | ❌ Locked | ❌ Done |

**Automatic transitions (via `sync-draws` cron)**:
- `upcoming` + draw found but **all players null** → `draw_published` (qualifying bracket synced, no notification)
- `upcoming` or `draw_published` + draw found **with named players** → `accepting_predictions` (main draw open, users notified by email + in-app)
- `accepting_predictions`: no auto-advance — set manually via admin panel or `set-tournament-status` API

**Manual transitions**: use `/admin` panel or `POST /api/admin/set-tournament-status`.

### `draws`
Raw bracket data for a tournament. One row per tournament (unique constraint on `tournament_id`).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tournament_id | uuid FK → tournaments | Unique — one draw per tournament |
| bracket_data | jsonb | Full bracket from the adapter (`Draw` type) |
| synced_at | timestamptz | Last API refresh |

### `predictions`
One row per user per tournament — their entire bracket as JSON.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| tournament_id | uuid FK → tournaments | |
| picks | jsonb | `{ "R128": { "match_1": "player_id" }, "R64": {...}, ... }` |
| is_locked | bool | True once draw closes — no further edits |
| is_practice | bool | Practice picks (completed tournaments) — never affect ranking_points |
| points_earned | int | Denormalised total for this bracket |
| expires_at | timestamptz | Stamped = starts_at + 364 days on first points award; null until then |
| submitted_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint: `(user_id, tournament_id)`

### `match_results`
One row per completed match.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tournament_id | uuid FK → tournaments | |
| external_match_id | text | ID from the API |
| round | text | `R128`, `R64`, `R32`, `R16`, `QF`, `SF`, `F` |
| winner_external_id | text | Player ID from the API |
| loser_external_id | text | |
| score | text | e.g. "6-3 7-5" |
| played_at | timestamptz | |

Unique: `(tournament_id, external_match_id)`

### `weekly_slots`
Enforces the one-ATP-slot + one-WTA-slot-per-ISO-week rule. Inserted when a user saves picks for the first time for a tournament.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| circuit | text | `ATP` or `WTA` |
| iso_year | int | ISO 8601 calendar year |
| iso_week | int | ISO 8601 week number (1–53) |
| tournament_id | uuid FK → tournaments | Which tournament consumed this slot |
| created_at | timestamptz | |

Unique constraint: `(user_id, circuit, iso_year, iso_week)` — DB-level enforcement.
Grand Slams insert **two** rows (they span two ISO weeks).

### `notifications`
In-app and email alert log.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → auth.users | |
| type | text | `draw_open` or `points_awarded` |
| tournament_id | uuid FK → tournaments | Nullable |
| meta | jsonb | Extra data (e.g. points amount) |
| read_at | timestamptz | Null = unread |
| created_at | timestamptz | |

### `leagues`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| owner_id | uuid FK → users | |
| name | text | |
| description | text | Nullable |
| invite_code | text unique | Auto-generated 8-char code |
| is_active | bool | |
| created_at | timestamptz | |

### `league_members`
Junction — users in a league.

| Column | Type | Notes |
|---|---|---|
| league_id | uuid FK → leagues | |
| user_id | uuid FK → users | |
| total_points | int | League-scoped cumulative points (synced by award-points cron) |
| joined_at | timestamptz | |

PK: `(league_id, user_id)`

### `friendships`
Friend request system. Directional — requester sends to addressee.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| requester_id | uuid FK → users | Who sent the request |
| addressee_id | uuid FK → users | Who received it |
| status | text | `pending`, `accepted`, `declined` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique: `(requester_id, addressee_id)`. Self-friendship prevented by check constraint.

### `challenges`
Head-to-head tournament prediction challenge between two users.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| challenger_id | uuid FK → users | Who created the challenge |
| challenged_id | uuid FK → users | Who was challenged |
| tournament_id | uuid FK → tournaments | The tournament being predicted |
| status | text | `pending`, `accepted`, `declined`, `expired`, `completed` |
| challenger_points | int | Nullable until scored |
| challenged_points | int | Nullable until scored |
| challenger_predictions_count | int | Nullable |
| challenged_predictions_count | int | Nullable |
| winner_id | uuid FK → users | Nullable until completed |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Note**: The `challenges` table in `001_initial_schema.sql` is an early draft (different columns) and was **replaced** by `006_challenges.sql`.

### `point_ledger` (legacy)
Append-only audit log created in `001_initial_schema.sql`. Still exists in the DB but the ranking system does not use it — `predictions.points_earned` + `recalculate_ranking_points()` is the source of truth. Kept for potential future analytics.

---

## SQL functions

### `recalculate_ranking_points(p_user_id UUID)`
Recomputes `ranking_points`, `atp_ranking_points`, `wta_ranking_points` for a single user. Called by the `award-points` cron after each tournament scores. Only counts locked, non-practice, non-expired predictions with `points_earned > 0`.

### `handle_new_user()`
Trigger on `auth.users INSERT` — auto-creates a `public.users` row. Sets `username_is_set = false` for OAuth signups (no username in metadata).

---

## ATP/WTA points per round

Stored as constants in `src/lib/tennis/points.ts`, not in the DB.

| Round | Grand Slam | Masters 1000 | 500 | 250 |
|---|---|---|---|---|
| R128/R64 | 10 | 10 | 0 | 0 |
| R32 | 45 | 25 | 20 | 6 |
| R16 | 90 | 45 | 30 | 13 |
| QF | 180 | 90 | 60 | 29 |
| SF | 360 | 180 | 90 | 45 |
| F (runner-up) | 720 | 360 | 150 | 80 |
| W (winner) | 2000 | 1000 | 500 | 250 |

Points are awarded for correctly predicting the **winner of each match** in each round.

---

## Row Level Security (summary)

| Table | SELECT | INSERT | UPDATE |
|---|---|---|---|
| users | anyone | via trigger only | own row |
| tournaments | anyone | service role only | service role only |
| draws | anyone | service role only | service role only |
| predictions | own rows only | own rows | own + unlocked only |
| match_results | anyone | service role only | — |
| weekly_slots | own rows | own rows | — |
| notifications | own rows | service role | own rows (mark read) |
| leagues | members only | own (as owner) | owner only |
| league_members | co-members | own row | — |
| friendships | own rows | own (as requester) | own (as addressee) |
| challenges | own rows | own (as challenger) | own (as challenged) |
