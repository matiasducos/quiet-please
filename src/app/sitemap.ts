import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { SITE_URL } from '@/lib/site'

// Tournament rows change as draws open and results land; an hour is a
// reasonable floor for how often crawlers should see a fresh list.
export const revalidate = 3600

/**
 * Cap on tournament URLs. Roughly 120 ATP + WTA events run per season, so this
 * holds several seasons — and it keeps the query under PostgREST's 1000-row
 * ceiling, which silently truncates rather than erroring.
 */
const MAX_TOURNAMENT_URLS = 500

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/tournaments`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/leaderboard`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/challenges/create`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/signup`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/login`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
  ]

  // Tournaments are publicly readable by RLS policy (001_initial_schema.sql),
  // so the anon key is the right credential here — no need for the admin client.
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: tournaments, error } = await supabase
    .from('tournaments')
    .select('id, starts_at, ends_at, status')
    .order('starts_at', { ascending: false })
    .limit(MAX_TOURNAMENT_URLS)

  if (error) {
    // A sitemap that 500s is worse than one missing the dynamic half — serve
    // the static routes and let the next revalidation try again.
    console.error('[sitemap] failed to load tournaments:', error.message)
    return staticRoutes
  }

  const tournamentRoutes: MetadataRoute.Sitemap = (tournaments ?? []).flatMap(t => {
    const lastModified = t.ends_at ?? t.starts_at ?? undefined
    const isSettled = t.status === 'completed'
    return [
      {
        url: `${SITE_URL}/tournaments/${t.id}`,
        lastModified: lastModified ? new Date(lastModified) : undefined,
        changeFrequency: isSettled ? ('yearly' as const) : ('daily' as const),
        priority: isSettled ? 0.4 : 0.8,
      },
      {
        url: `${SITE_URL}/tournaments/${t.id}/results`,
        lastModified: lastModified ? new Date(lastModified) : undefined,
        changeFrequency: isSettled ? ('yearly' as const) : ('daily' as const),
        priority: 0.5,
      },
    ]
  })

  return [...staticRoutes, ...tournamentRoutes]
}
