-- 039_dsg_integration.sql
-- DSG (DataSportsGroup) live data integration:
-- 1. Player ID mapping table (api-tennis ↔ DSG)
-- 2. DSG competition ID on tournaments
-- 3. DSG sync audit log

-- ── 1. Player ID Mapping ─────────────────────────────────────────────────────

CREATE TABLE public.player_id_map (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  api_tennis_id   text        NOT NULL,
  dsg_player_id   text        NOT NULL,
  player_name     text        NOT NULL,            -- canonical name for display/debugging
  country         text,                            -- ISO country code
  match_method    text        NOT NULL DEFAULT 'fuzzy'
                              CHECK (match_method IN ('fuzzy', 'manual', 'exact')),
  match_score     real,                            -- fuzzy match confidence 0-1, null for manual
  verified        boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (api_tennis_id),
  UNIQUE (dsg_player_id)
);

ALTER TABLE public.player_id_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Player ID map is publicly readable"
  ON public.player_id_map FOR SELECT USING (true);

CREATE INDEX idx_player_id_map_api ON public.player_id_map(api_tennis_id);
CREATE INDEX idx_player_id_map_dsg ON public.player_id_map(dsg_player_id);
CREATE INDEX idx_player_id_map_verified ON public.player_id_map(verified) WHERE verified = true;

-- ── 2. DSG Competition ID on Tournaments ─────────────────────────────────────

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS dsg_competition_id text;

COMMENT ON COLUMN public.tournaments.dsg_competition_id IS
  'DSG DataSportsGroup competition ID for live status polling. Null = no DSG mapping.';

CREATE INDEX idx_tournaments_dsg ON public.tournaments(dsg_competition_id)
  WHERE dsg_competition_id IS NOT NULL;

-- ── 3. DSG Sync Audit Log ────────────────────────────────────────────────────

CREATE TABLE public.dsg_sync_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid        REFERENCES public.tournaments(id) ON DELETE CASCADE,
  matches_checked int         NOT NULL DEFAULT 0,
  matches_locked  int         NOT NULL DEFAULT 0,
  errors          jsonb       DEFAULT '[]',
  synced_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dsg_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "DSG sync log is readable by all"
  ON public.dsg_sync_log FOR SELECT USING (true);

-- Auto-cleanup: keep only 7 days of sync logs
CREATE INDEX idx_dsg_sync_log_synced ON public.dsg_sync_log(synced_at);
