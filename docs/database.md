# Database schema

All tables live in Supabase (PostgreSQL). Row Level Security (RLS) is enabled on all tables.

## Tables

### `users`
Extended profile linked to Supabase Auth (`auth.users`).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Matches `auth.users.id` |
| username | text unique | Public display name |
| email | text | From auth |
| avatar_url | text | Stored in Supabase Storage |
| total_points | int | Denormalised sum — updated after each award |
| created_at | timestamptz | |

### `tournaments`
One row per ATP/WTA tournament edition (e.g. "Wimbledon 2025 Men's Singles").

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| external_id | text unique | ID from the tennis API provider |
| name | text | e.g. "Wimbledon Men's Singles 2025" |
| tour | text | `ATP` or `WTA` |
| category | text | `grand_slam`, `masters_1000`, `500`, `250` |
| surface | text | `hard`, `clay`, `grass` |
| draw_close_at | timestamptz | Predictions lock at this time |
| starts_at | timestamptz | |
| ends_at | timestamptz | |
| status | text | `upcoming`, `accepting_predictions`, `in_progress`, `completed` |

### `draws`
Stores the raw bracket data for a tournament.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tournament_id | uuid FK → tournaments | |
| bracket_data | jsonb | Full bracket structure from the adapter |
| synced_at | timestamptz | Last time this was refreshed from the API |

### `predictions`
One row per user per tournament — holds their entire bracket as JSON.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| tournament_id | uuid FK → tournaments | |
| picks | jsonb | `{ "R128": { "match_1": "player_id", ... }, "R64": {...}, ... }` |
| is_locked | bool | Set to true at draw_close_at |
| points_earned | int | Denormalised total for this prediction |
| submitted_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint: `(user_id, tournament_id)` — one prediction per user per tournament.

### `match_results`
One row per completed match in a tournament.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tournament_id | uuid FK → tournaments | |
| external_match_id | text | ID from the tennis API |
| round | text | `R128`, `R64`, `R32`, `R16`, `QF`, `SF`, `F` |
| winner_external_id | text | Player ID from the API |
| loser_external_id | text | |
| score | text | e.g. "6-3 7-5" |
| played_at | timestamptz | |

### `point_ledger`
Append-only audit log of every point award. Never updated, only inserted.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| tournament_id | uuid FK → tournaments | |
| match_result_id | uuid FK → match_results | |
| round | text | Round the point was awarded for |
| points | int | Points earned for this correct pick |
| awarded_at | timestamptz | |

### `leagues`
Private groups where users compete against each other across the full calendar.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| owner_id | uuid FK → users | |
| name | text | |
| description | text | |
| invite_code | text unique | Short code for sharing join link |
| is_active | bool | |
| created_at | timestamptz | |

### `league_members`
Junction table — users in a league, with their cumulative league score.

| Column | Type | Notes |
|---|---|---|
| league_id | uuid FK → leagues | |
| user_id | uuid FK → users | |
| total_points | int | Points earned within this league |
| joined_at | timestamptz | |

Primary key: `(league_id, user_id)`

### `challenges`
Head-to-head challenge between two users, optionally scoped to a tournament.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| league_id | uuid FK → leagues | Optional — challenge within a league |
| challenger_id | uuid FK → users | |
| opponent_id | uuid FK → users | |
| tournament_id | uuid FK → tournaments | Optional — single tournament challenge |
| status | text | `pending`, `accepted`, `declined`, `completed` |
| created_at | timestamptz | |

## ATP/WTA points per round

These are stored as constants in `src/lib/tennis/points.ts`, not in the DB.

| Round | Grand Slam | Masters 1000 | ATP 500 | ATP 250 |
|---|---|---|---|---|
| R128/R64 | 10 | 10 | 0 | 0 |
| R32 | 45 | 25 | 20 | 6 |
| R16 | 90 | 45 | 30 | 13 |
| QF | 180 | 90 | 60 | 29 |
| SF | 360 | 180 | 90 | 45 |
| F (runner-up) | 720 | 360 | 150 | 80 |
| W (winner) | 2000 | 1000 | 500 | 250 |

> Note: In the prediction game, points are awarded for correctly predicting the winner of each match in each round — matching the round value from the table above.

## Row Level Security policies (summary)

- `users` — users can read all profiles, update only their own
- `predictions` — users can read/write their own only; locked predictions cannot be updated
- `leagues` — members can read their leagues; only owner can update
- `league_members` — readable by all members of the same league
- `point_ledger` — readable by the user who earned the points; insert via service role only
- `match_results` — public read; insert via service role only (cron jobs)
