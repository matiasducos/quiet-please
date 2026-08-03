-- 073_backfill_tournament_series
--
-- Creates one series per tournament currently in the table and links each 2026
-- edition to it. Every row in public.tournaments today is a 2026 ATP event, so
-- this is a 1:1 backfill — the first genuine multi-edition series appears when
-- 2027 rows land and are pointed at these same series ids.
--
-- The slug for each series is CURATED, not derived. Auto-slugging from `name`
-- produces the wrong URL for 22 of these 34 rows, because the stored name is a
-- title sponsor: "Terra Wortmann Open" (Halle), "Generali Open" (Kitzbühel),
-- "HSBC Championships" (Queen's Club), "Nordea Open" (Båstad).
--
-- Slugs were chosen from Wikipedia's PARENT (series) article title, which is
-- picked under a policy of using the name most common in English-language
-- sources, and which solves the identical problem this table does: one stable
-- name for a recurring event whose yearly branding churns. Note the Canadian
-- Open, where Wikipedia's yearly articles say "National Bank Open" but the
-- series article says "Canadian Open" — slugging from yearly usage would have
-- baked a sponsor into a permanent URL.
--
-- Three deliberate departures from that rule, where the encyclopedic title is
-- an archival formal name nobody would type into a search box:
--   * wimbledon      (not "wimbledon-championships") — single-word global brand
--   * munich-open    (not "bavarian-international-tennis-championships")
--   * barcelona-open (not "barcelona-open-banc-sabadell") — strips the sponsor
--
-- Everything except slug/name/short_name is copied from the linked edition row
-- rather than retyped, so this file has no chance of disagreeing with the data.

with m(external_id, slug, series_name, short_name) as (
  values
    -- Grand Slams
    ('us-open',                                        'us-open',                            'US Open',                             'US Open'),
    ('wimbledon',                                      'wimbledon',                          'Wimbledon',                           'Wimbledon'),
    -- Stored as "Roland Garros"; "French Open" is the English common name and
    -- the title of the Wikipedia article.
    ('roland-garros',                                  'french-open',                        'French Open',                         'French Open'),

    -- Masters 1000
    ('1928',                                           'miami-open',                         'Miami Open',                          'Miami Open'),
    ('1970',                                           'monte-carlo-masters',                'Monte-Carlo Masters',                 'Monte-Carlo'),
    ('mutua-madrid-open',                              'madrid-open',                        'Madrid Open',                         'Madrid Open'),
    ('internazionali-bnl-ditalia',                     'italian-open',                       'Italian Open',                        'Italian Open'),
    ('national-bank-open-presented-by-rogers',         'canadian-open',                      'Canadian Open',                       'Canadian Open'),
    ('cincinnati-open',                                'cincinnati-open',                    'Cincinnati Open',                     'Cincinnati Open'),

    -- ATP 500
    ('barcelona-open-banc-sabadell',                   'barcelona-open',                     'Barcelona Open',                      'Barcelona Open'),
    ('bmw-open-by-bitpanda',                           'munich-open',                        'Munich Open',                         'Munich Open'),
    ('bitpanda-hamburg-open',                          'hamburg-open',                       'Hamburg Open',                        'Hamburg Open'),
    ('terra-wortmann-open',                            'halle-open',                         'Halle Open',                          'Halle Open'),
    ('hsbc-championships',                             'queens-club-championships',          'Queen''s Club Championships',         'Queen''s Club'),
    ('china-open',                                     'china-open',                         'China Open',                          'China Open'),
    ('kinoshita-group-japan-open-tennis-championships','japan-open',                         'Japan Open',                          'Japan Open'),

    -- ATP 250
    ('mubadala-citi-dc-open',                          'washington-open',                    'Washington Open',                     'Washington Open'),
    ('winstonsalem-open',                              'winston-salem-open',                 'Winston-Salem Open',                  'Winston-Salem'),
    ('chengdu-open',                                   'chengdu-open',                       'Chengdu Open',                        'Chengdu Open'),
    ('hangzhou-open',                                  'hangzhou-open',                      'Hangzhou Open',                       'Hangzhou Open'),
    ('mifel-tennis-open-by-telcel-oppo',               'los-cabos-open',                     'Los Cabos Open',                      'Los Cabos Open'),
    ('millennium-estoril-open',                        'estoril-open',                       'Estoril Open',                        'Estoril Open'),
    ('generali-open',                                  'austrian-open-kitzbuhel',            'Austrian Open Kitzbühel',             'Kitzbühel'),
    ('efg-swiss-open-gstaad',                          'swiss-open-gstaad',                  'Swiss Open Gstaad',                   'Gstaad'),
    ('plava-laguna-croatia-open-umag',                 'croatia-open-umag',                  'Croatia Open Umag',                   'Umag'),
    ('nordea-open',                                    'swedish-open',                       'Swedish Open',                        'Swedish Open'),
    ('lexus-eastbourne-open',                          'eastbourne-international',           'Eastbourne International',            'Eastbourne'),
    ('vanda-pharmaceuticals-mallorca-championships',   'mallorca-championships',             'Mallorca Championships',              'Mallorca'),
    ('boss-open',                                      'stuttgart-open',                     'Stuttgart Open',                      'Stuttgart Open'),
    ('libema-open',                                    'rosmalen-grass-court-championships', 'Rosmalen Grass Court Championships',  'Rosmalen'),
    ('gonet-geneva-open',                              'geneva-open',                        'Geneva Open',                         'Geneva Open'),
    ('1978',                                           'romanian-open',                      'Romanian Open',                       'Bucharest'),
    ('1960',                                           'us-mens-clay-court-championships',   'U.S. Men''s Clay Court Championships','Houston'),
    ('2270',                                           'grand-prix-hassan-ii',               'Grand Prix Hassan II',                'Marrakech')
),
new_series as (
  insert into public.tournament_series
    (slug, name, short_name, city, country, flag_emoji, surface, category, slug_reviewed)
  select
    m.slug,
    m.series_name,
    m.short_name,
    -- tournaments.location is "City, Country" on every current row.
    nullif(split_part(t.location, ', ', 1), ''),
    nullif(split_part(t.location, ', ', 2), ''),
    t.flag_emoji,
    t.surface,
    t.category,
    -- Curated by hand in this file, so reviewed by definition.
    true
  from m
  join public.tournaments t
    on t.external_id = m.external_id
   and t.starts_year = 2026
  -- DO UPDATE rather than DO NOTHING so the statement is idempotent AND still
  -- RETURNINGs every row: DO NOTHING returns nothing on conflict, which would
  -- leave the link step below a no-op on a re-run.
  on conflict (slug) do update
    set name       = excluded.name,
        short_name = excluded.short_name,
        city       = coalesce(excluded.city, public.tournament_series.city),
        country    = coalesce(excluded.country, public.tournament_series.country),
        flag_emoji = coalesce(excluded.flag_emoji, public.tournament_series.flag_emoji),
        surface    = coalesce(excluded.surface, public.tournament_series.surface),
        category   = coalesce(excluded.category, public.tournament_series.category)
  returning id, slug
)
update public.tournaments t
   set series_id = ns.id
  from m
  join new_series ns on ns.slug = m.slug
 where t.external_id = m.external_id
   and t.starts_year = 2026;

-- ============================================================
-- VERIFICATION
--
-- Asserted in SQL rather than eyeballed. A silently partial backfill would
-- surface as tournaments that 404 on their slug URL — visible only once the
-- pages are live and crawled, which is far too late to notice.
-- ============================================================
do $$
declare
  unmapped  int;
  linked    int;
  series_n  int;
  dupes     int;
  orphans   int;
  stragglers text;
begin
  -- A short series count is how a mistyped external_id shows up: the CTE joins
  -- tournaments, so a value matching no row simply produces no series.
  select count(*) into series_n from public.tournament_series;
  if series_n <> 34 then
    raise exception
      'Expected 34 series, found % — an external_id in the mapping matched no 2026 tournament', series_n;
  end if;

  -- Every series must have at least one edition pointing at it.
  --
  -- Phrased this way rather than "exactly 34 tournaments are linked" so the
  -- check stays true on a re-run: once new rows have been given a series in
  -- admin the total climbs above 34, which says nothing about whether THIS
  -- backfill worked. An orphaned series does — it means the UPDATE half of the
  -- statement did not land, and its slug URL would 404.
  select count(*) into orphans
    from public.tournament_series s
   where not exists (select 1 from public.tournaments t where t.series_id = s.id);
  if orphans > 0 then
    raise exception
      '% series have no linked edition — the backfill UPDATE did not apply', orphans;
  end if;

  select count(*) into linked
    from public.tournaments where series_id is not null;

  -- Tournaments outside the mapping are a NOTICE, not a failure.
  --
  -- Deliberately not fatal: a row added after this file was written is a
  -- legitimate state — it simply has no series yet, which makes it noindex and
  -- keeps it out of the sitemap until someone assigns one in admin. Aborting
  -- here would roll back a correct backfill because of an unrelated new row.
  select count(*) into unmapped from public.tournaments where series_id is null;
  if unmapped > 0 then
    select string_agg(format('%s (%s)', name, starts_year), ', ' order by starts_year desc, name)
      into stragglers
      from public.tournaments where series_id is null;
    raise notice
      'NOT BACKFILLED (%): %. These have no slug URL until a series is assigned in admin.',
      unmapped, stragglers;
  end if;

  -- Every edition must be reachable at exactly one URL.
  select count(*) into dupes from (
    select series_id, starts_year, tour
      from public.tournaments
     where series_id is not null
     group by series_id, starts_year, tour
    having count(*) > 1
  ) d;
  if dupes > 0 then
    raise exception '% (series, year, tour) collision(s) — some editions share a URL', dupes;
  end if;

  raise notice 'OK: % series, % editions linked, no URL collisions', series_n, linked;
end $$;
