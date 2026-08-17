-- 086: keep renamed series URLs alive
--
-- Renaming a series slug in /admin/tournaments/series moves the hub URL and
-- every edition URL under it, and leaves the old ones returning 404. The rename
-- action already warns that "moving an indexed URL 404s every external link to
-- it" — but the warning is all there was, so the first rename that happened
-- did exactly that.
--
-- Concretely: `japan-open` became `tokyo-open` on 2026-08-05, and Search
-- Console still lists /tournaments/japan-open/2026 as an indexed URL ranking in
-- position 9. Google holds a well-ranked URL that resolves to nothing.
--
-- This table is the redirect map. A retired slug resolves to the series that
-- used to own it, and both public routes turn that into a 301 rather than a
-- 404, so the ranking and any external links survive the rename.

CREATE TABLE IF NOT EXISTS tournament_series_slug_history (
  -- The RETIRED slug, and the primary key: a slug is a URL, so it can only
  -- ever have belonged to one series. Making it the key is also what stops a
  -- future rename from pointing one dead URL at two destinations.
  slug       text PRIMARY KEY,
  series_id  uuid NOT NULL REFERENCES tournament_series(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Same contract as tournament_series.slug. A retired slug that could not
  -- have been a real URL is a row that can never match a request.
  CONSTRAINT series_slug_history_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

COMMENT ON TABLE tournament_series_slug_history IS
  'Retired series slugs, so a renamed hub and its editions 301 instead of 404. '
  'Written by the admin rename action; read by /tournaments/[slug] and '
  '/tournaments/[slug]/[year] before they give up and call notFound().';

COMMENT ON COLUMN tournament_series_slug_history.slug IS
  'The old slug. Primary key because a URL can only ever have named one series.';

-- The lookup is by primary key, so no extra index is needed on `slug`. This one
-- serves the other direction: "has this series been renamed before?", which the
-- rename action asks so that renaming BACK to an old slug clears its own
-- tombstone rather than leaving a row that would redirect a live URL to itself.
CREATE INDEX IF NOT EXISTS idx_series_slug_history_series
  ON tournament_series_slug_history (series_id);

-- Read exclusively by server code holding the service role — the public routes
-- resolve it with the admin client, same as every other series lookup. No
-- policy, so nothing else can reach it.
ALTER TABLE tournament_series_slug_history ENABLE ROW LEVEL SECURITY;

-- ── Backfill the one rename that already happened ───────────────────────────
--
-- Guarded rather than hardcoded to an id: if this ever runs against a database
-- where the series was never renamed, or was renamed to something else, it
-- should do nothing rather than mint a redirect to the wrong place.
INSERT INTO tournament_series_slug_history (slug, series_id)
SELECT 'japan-open', id FROM tournament_series WHERE slug = 'tokyo-open'
ON CONFLICT (slug) DO NOTHING;
