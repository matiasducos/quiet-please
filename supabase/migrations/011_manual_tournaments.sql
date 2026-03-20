-- 011_manual_tournaments
-- Players table + tournament columns for manual tournament creation

-- ============================================================
-- PLAYERS
-- Reusable player registry for manual draw building
-- ============================================================
CREATE TABLE public.players (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT        UNIQUE NOT NULL,
  name        TEXT        NOT NULL,
  country     TEXT        NOT NULL DEFAULT '',
  tour        TEXT        NOT NULL CHECK (tour IN ('ATP', 'WTA')),
  seed        SMALLINT,
  ranking     SMALLINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players are publicly readable"
  ON public.players FOR SELECT USING (true);

CREATE INDEX idx_players_tour        ON public.players (tour);
CREATE INDEX idx_players_name        ON public.players (name);
CREATE INDEX idx_players_external_id ON public.players (external_id);

-- ============================================================
-- TOURNAMENT COLUMNS
-- draw_size: 32/64/128
-- is_manual: distinguishes admin-created from API-synced
-- ============================================================
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS draw_size  SMALLINT,
  ADD COLUMN IF NOT EXISTS is_manual  BOOLEAN NOT NULL DEFAULT false;
