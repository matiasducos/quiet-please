# Auto-Prediction Feature — Implementation Plan

## Context

Users who can't check daily which players are playing miss prediction windows. This feature lets users configure up to 5 priority players per tour (ATP/WTA), optionally per surface. When a draw is published, the system auto-generates bracket predictions, locks them immediately, and notifies the user. Access is admin-controlled via a per-user toggle.

**Scope:** Global predictions only (not challenges). Leagues benefit automatically since they use global predictions.

---

## Key Decisions (confirmed with user)

- **5 players per tour** (ATP/WTA), priority-ordered (1=highest)
- **Surface overrides**: default list + optional per-surface overrides (hard, clay, grass)
- **UI location**: `/profile/auto-predictions` page
- **Admin control**: `auto_predict_enabled` boolean on users table, toggled per-user in admin panel
- **Neither player in list** → leave unpredicted
- **Two priority players meet** → lower priority number wins
- **Weekly slots**: auto-predict higher-category tournament (GS > M1000 > 500 > 250)
- **Immediately fully locked** (`is_fully_locked = true`) — user cannot edit
- **Per-pick source tracking**: `pick_sources` JSONB on predictions `{ matchId: "auto" | "manual" }`
- **Backfill**: all existing predictions → all picks marked "manual"
- **Notification**: new type `auto_predictions_generated`
- **Separate cron job** (not inline with sync-draws)
- **Draw changes**: cron is idempotent — re-runs when `draws.synced_at > last run`
- **Overwrites unlocked manual picks** if automation runs after user started a draft
- **Respects existing full locks** — if user manually locked, auto-predict skips

---

## Phase 1: Database Migration (`supabase/migrations/033_auto_predictions.sql`)

### 1a. New table: `auto_predict_players`
```sql
CREATE TABLE public.auto_predict_players (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tour               TEXT NOT NULL CHECK (tour IN ('ATP', 'WTA')),
  surface            TEXT CHECK (surface IN ('hard', 'clay', 'grass')),
  -- NULL = default for all surfaces; 'hard'/'clay'/'grass' = override
  player_external_id TEXT NOT NULL,
  player_name        TEXT NOT NULL,  -- denormalized for display
  priority           INT  NOT NULL CHECK (priority BETWEEN 1 AND 5),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique indexes (NULL-safe for surface)
CREATE UNIQUE INDEX idx_auto_predict_default_priority
  ON auto_predict_players (user_id, tour, priority) WHERE surface IS NULL;
CREATE UNIQUE INDEX idx_auto_predict_surface_priority
  ON auto_predict_players (user_id, tour, surface, priority) WHERE surface IS NOT NULL;
CREATE UNIQUE INDEX idx_auto_predict_default_player
  ON auto_predict_players (user_id, tour, player_external_id) WHERE surface IS NULL;
CREATE UNIQUE INDEX idx_auto_predict_surface_player
  ON auto_predict_players (user_id, tour, surface, player_external_id) WHERE surface IS NOT NULL;
CREATE INDEX idx_auto_predict_user_tour ON auto_predict_players (user_id, tour);
```

### 1b. Add `auto_predict_enabled` to users
```sql
ALTER TABLE public.users ADD COLUMN auto_predict_enabled BOOLEAN NOT NULL DEFAULT false;
```

### 1c. Add `pick_sources` to predictions + backfill
```sql
ALTER TABLE public.predictions ADD COLUMN pick_sources JSONB;

-- Backfill: all existing picks → "manual"
UPDATE public.predictions
SET pick_sources = (SELECT jsonb_object_agg(key, 'manual') FROM jsonb_each_text(picks))
WHERE picks IS NOT NULL AND picks != '{}'::jsonb AND pick_sources IS NULL;
```

### 1d. Audit table: `auto_predict_runs`
```sql
CREATE TABLE public.auto_predict_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id        UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  triggered_by         TEXT NOT NULL CHECK (triggered_by IN ('cron', 'draw_change', 'admin')),
  users_processed      INT NOT NULL DEFAULT 0,
  predictions_created  INT NOT NULL DEFAULT 0,
  predictions_updated  INT NOT NULL DEFAULT 0,
  errors               JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auto_predict_runs_tournament ON auto_predict_runs (tournament_id, created_at DESC);
```

### 1e. Update notifications constraint
Add `'auto_predictions_generated'` to CHECK constraint.

### 1f. RLS policies
- `auto_predict_players`: users can SELECT/INSERT/UPDATE/DELETE their own rows
- `auto_predict_runs`: no RLS needed (only written by cron via admin client)

---

## Phase 2: Core Algorithm (`src/lib/tennis/auto-predict.ts`)

### `generateAutoPicks(matches, priorityPlayers)` → `{ picks, pickSources } | null`

**Reuses from `src/lib/tennis/bracket.ts`:**
- `buildFeedMap()`, `buildReverseFeedMap()`, `isByeMatch()`, `getMatchesByRound()`, `getSortedRounds()`

**Algorithm (round-by-round, first round → final):**

1. Build `priorityMap: Map<externalId, priority>` from user's player list
2. Build `feedMap` and `reverseFeedMap` from draw matches
3. Pre-populate `matchWinners: Record<matchId, externalId>` for all BYE matches
4. For each round (R128→R64→...→F), for each match:
   - Skip BYE matches (already handled)
   - Resolve player1 and player2 via: direct draw data → `matchWinners[feederMatchId]`
   - If both in priority list → lower priority number wins
   - If one in list → pick that one
   - If neither → skip (leave unpredicted)
   - Record winner in `matchWinners` + `picks` + `pickSources["auto"]`
5. Return `null` if no picks generated

**Key property:** Processing rounds in order ensures `matchWinners` is populated before downstream rounds need it. Unpredicted branches cascade naturally.

---

## Phase 3: Cron Job (`src/app/api/cron/auto-predict/route.ts`)

**Schedule:** Daily at 09:30 UTC (after sync-draws at 09:00).

**Flow:**
1. Query `accepting_predictions` tournaments with draws
2. Filter to: no `auto_predict_runs` row, OR `draws.synced_at > last run created_at` (for draw changes)
3. Fetch users with `auto_predict_enabled = true`
4. Batch-fetch all `auto_predict_players` for those users
5. For each tournament × user:
   a. Resolve player list (surface-specific → default fallback)
   b. Weekly slot check (compare categories, skip if lower/equal)
   c. Skip if user already has `is_fully_locked = true` prediction for this tournament
   d. Run `generateAutoPicks()`
   e. Upsert prediction (fully locked, all pick_locks = 'auto_lock_all', pick_sources = 'auto')
   f. Upsert weekly_slots
   g. Queue notification
6. Bulk insert notifications
7. Insert `auto_predict_runs` audit row

**Uses:** `withCronLogging`, `isAuthorized`, `createAdminClient`, `insertNotifications`, `getTournamentISOWeeks`

---

## Phase 4: Admin Panel Changes

### 4a. `src/app/admin/AdminPanel.tsx`
- Add `'auto-predict'` tab (🤖 icon)
- User search + toggle + "Run Auto-Predict Now" button + recent runs table

### 4b. `src/app/admin/actions.ts`
- `getAutoPredictStats()` → `{ enabledCount, recentRuns }`
- `searchUsersForAutoPredict(query)` → users with toggle state
- `toggleAutoPredict(userId, enabled)` → set flag

### 4c. `src/app/admin/page.tsx`
- Add `getAutoPredictStats()` to Promise.all

### 4d. Add to cron endpoints in AdminPanel

---

## Phase 5: User Configuration UI

### 5a. `src/app/profile/auto-predictions/page.tsx` (server component)
- Auth guard, check `auto_predict_enabled`, fetch config, render client component

### 5b. `src/app/profile/auto-predictions/AutoPredictConfig.tsx` (client component)
- Two sections: ATP + WTA
- Default list + surface override expandables
- Player search (debounced 300ms), priority slots, save per section
- Warning: "Auto-predictions are locked immediately"

### 5c. `src/app/profile/auto-predictions/actions.ts`
- `getAutoPredictConfig()`, `searchPlayersForAutoPredict()`, `saveAutoPredictList()`, `removeAutoPredictOverride()`

### 5d. `src/app/profile/[username]/page.tsx`
- Add "Auto-Predictions" link next to "Friends →" for own profile

---

## Phase 6: Notification Integration

1. **DB constraint** — migration (Phase 1e)
2. **Insert** — cron (Phase 3)
3. **`src/app/notifications/page.tsx`**: TYPE_META + getHref (→ `/tournaments/:id/predict`) + message template
4. **`src/app/admin/constants.ts`**: add to NOTIFICATION_TYPES

---

## Phase 7: Pick Source Tracking (`src/app/tournaments/[id]/predict/actions.ts`)

In `savePrediction()`: build `pick_sources` with all submitted matchIds → `"manual"`. On UPDATE, merge with existing (preserve `"auto"` for untouched matches).

---

## Files Summary

### New files (6):
| File | Purpose |
|------|---------|
| `supabase/migrations/033_auto_predictions.sql` | All DB changes |
| `src/lib/tennis/auto-predict.ts` | Core algorithm |
| `src/app/api/cron/auto-predict/route.ts` | Cron job |
| `src/app/profile/auto-predictions/page.tsx` | Config page (server) |
| `src/app/profile/auto-predictions/AutoPredictConfig.tsx` | Config UI (client) |
| `src/app/profile/auto-predictions/actions.ts` | Config server actions |

### Modified files (7):
| File | Changes |
|------|---------|
| `src/app/admin/AdminPanel.tsx` | New 'auto-predict' tab |
| `src/app/admin/actions.ts` | 3 new admin actions |
| `src/app/admin/page.tsx` | Fetch auto-predict stats |
| `src/app/admin/constants.ts` | Add notification type |
| `src/app/notifications/page.tsx` | Notification rendering |
| `src/app/tournaments/[id]/predict/actions.ts` | `pick_sources` tracking |
| `src/app/profile/[username]/page.tsx` | "Auto-Predictions" link |

---

## Implementation Order

1. Migration 033
2. `src/lib/tennis/auto-predict.ts` (core algorithm)
3. `src/app/tournaments/[id]/predict/actions.ts` (pick_sources)
4. `src/app/profile/auto-predictions/` (user config — 3 files)
5. `src/app/profile/[username]/page.tsx` (add link)
6. `src/app/admin/` changes (3 files)
7. `src/app/notifications/page.tsx` + `constants.ts`
8. `src/app/api/cron/auto-predict/route.ts` (cron — ties it all together)
