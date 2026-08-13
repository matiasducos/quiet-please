import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { SITE_URL } from '@/lib/site'
import { ALL_SLAMS } from '@/lib/slams/config'

// Tournament rows change as draws open and results land; an hour is a
// reasonable floor for how often crawlers should see a fresh list.
export const revalidate = 3600

/**
 * Row cap. Roughly 120 ATP + WTA events run per season, so this holds several
 * seasons — and it keeps the query under PostgREST's 1000-row ceiling, which
 * silently truncates rather than erroring.
 *
 * When the tournaments table approaches this, the fix is a sitemap index
 * (Next.js `generateSitemaps`) splitting by season, not a bigger number. The
 * hard protocol limit is 50,000 URLs per sitemap; at ~2 URLs per edition that
 * is around 25,000 editions, which is roughly a century of play.
 */
const MAX_EDITION_ROWS = 900

type EditionRow = {
  starts_year: number | null
  updated_at: string | null
  tournament_series: { slug: string; slug_reviewed: boolean; updated_at: string | null } | null
  draws: { synced_at: string | null }[] | null
}

function latest(...dates: (string | null | undefined)[]): Date | undefined {
  const times = dates
    .filter((d): d is string => Boolean(d))
    .map(d => Date.parse(d))
    .filter(t => Number.isFinite(t))
  return times.length > 0 ? new Date(Math.max(...times)) : undefined
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/tournaments`, changeFrequency: 'daily', priority: 0.9 },
    // Grand Slam landing pages — evergreen, so they stay listed year-round
    // rather than only while an edition is live.
    ...ALL_SLAMS.map(slam => ({
      url: `${SITE_URL}${slam.route}`,
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    })),
    { url: `${SITE_URL}/leaderboard`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/challenges/create`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/signup`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/login`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/data-deletion`, changeFrequency: 'yearly', priority: 0.2 },
  ]

  // Tournaments and series are publicly readable by RLS policy, so the anon key
  // is the right credential here — no need for the admin client.
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )

  const { data, error } = await supabase
    .from('tournaments')
    .select(
      'starts_year, updated_at, tournament_series!inner(slug, slug_reviewed, updated_at), draws(synced_at)',
    )
    .not('series_id', 'is', null)
    .order('starts_year', { ascending: false })
    .limit(MAX_EDITION_ROWS)

  if (error) {
    // A sitemap that 500s is worse than one missing the dynamic half — serve
    // the static routes and let the next revalidation try again.
    console.error('[sitemap] failed to load tournaments:', error.message)
    return staticRoutes
  }

  const rows = (data ?? []) as unknown as EditionRow[]

  // One entry per (series, year): the two tours of an edition share a URL.
  const editions = new Map<string, { slug: string; year: number; lastModified?: Date }>()
  // Hub lastModified is the most recent change across all of its editions.
  const hubs = new Map<string, { slug: string; lastModified?: Date }>()

  for (const row of rows) {
    const series = row.tournament_series
    // Unreviewed slugs are auto-created by the sync cron and are noindex until
    // an admin confirms the URL — listing them would invite crawls of pages
    // that explicitly ask not to be indexed.
    if (!series?.slug_reviewed || row.starts_year == null) continue

    const drawSyncedAt = row.draws?.[0]?.synced_at ?? null
    const changed = latest(row.updated_at, drawSyncedAt)

    const editionKey = `${series.slug}/${row.starts_year}`
    const existingEdition = editions.get(editionKey)
    editions.set(editionKey, {
      slug: series.slug,
      year: row.starts_year,
      lastModified: latest(
        existingEdition?.lastModified?.toISOString(),
        changed?.toISOString(),
      ),
    })

    const existingHub = hubs.get(series.slug)
    hubs.set(series.slug, {
      slug: series.slug,
      lastModified: latest(
        existingHub?.lastModified?.toISOString(),
        changed?.toISOString(),
        series.updated_at,
      ),
    })
  }

  const currentYear = new Date().getUTCFullYear()

  const hubRoutes: MetadataRoute.Sitemap = [...hubs.values()].map(hub => ({
    url: `${SITE_URL}/tournaments/${hub.slug}`,
    lastModified: hub.lastModified,
    // The evergreen URL: the one accumulating authority, so it ranks above
    // any single edition.
    changeFrequency: 'weekly',
    priority: 0.9,
  }))

  const editionRoutes: MetadataRoute.Sitemap = [...editions.values()].map(edition => {
    const isCurrent = edition.year >= currentYear
    return {
      url: `${SITE_URL}/tournaments/${edition.slug}/${edition.year}`,
      lastModified: edition.lastModified,
      // Past editions are frozen archives; this season's still move.
      changeFrequency: isCurrent ? 'daily' : 'yearly',
      priority: isCurrent ? 0.8 : 0.5,
    }
  })

  return [...staticRoutes, ...hubRoutes, ...editionRoutes]
}
