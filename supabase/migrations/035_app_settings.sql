-- App-wide settings (key/value store)
-- Used for feature toggles like prediction_mode without schema changes.

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: anyone can read, only service-role (admin client) can write
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON app_settings
  FOR SELECT USING (true);

-- Seed the prediction mode setting
-- 'anytime'         = current behaviour (predict during accepting_predictions + in_progress)
-- 'pre_tournament'  = safer mode (predict only during accepting_predictions)
INSERT INTO app_settings (key, value)
VALUES ('prediction_mode', '"anytime"'::jsonb)
ON CONFLICT (key) DO NOTHING;
