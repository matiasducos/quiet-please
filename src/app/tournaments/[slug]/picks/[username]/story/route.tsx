import { ImageResponse } from 'next/og'
import { loadSocialFonts } from '@/lib/social/fonts'
import { getPicksCard } from '@/lib/social/picks-data'
import { renderCard } from '@/lib/social/templates/cards'
import { DIMENSIONS, type CardSize } from '@/lib/social/templates/frame'
import { resolveTournamentParam } from '@/lib/tournaments/series'

/**
 * A user's bracket as a shareable image.
 *
 * The public sibling of the admin studio's renderer, and deliberately the same
 * templates: a second implementation of the card design would drift, and this
 * one is the version most people will actually see.
 *
 * Story size by default, because that is what it is for. `?size=square` is
 * there for a feed post.
 *
 * Node runtime, not edge — the fonts are read off disk (lib/social/fonts.ts).
 */
export const runtime = 'nodejs'

const SIZES: CardSize[] = ['story', 'square']

/** Plain text, since the caller is an <img> or a fetch for a File. */
function fail(message: string, status: number): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain' } })
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string; username: string }> },
): Promise<Response> {
  const { slug, username } = await ctx.params

  const resolved = await resolveTournamentParam(slug)
  if (!resolved) return fail('Tournament not found', 404)

  const url = new URL(req.url)
  const size = (url.searchParams.get('size') ?? 'story') as CardSize
  if (!SIZES.includes(size)) return fail(`Unknown size "${size}"`, 400)

  const result = await getPicksCard(resolved.tournamentId, username, url.origin)
  if (!result.ok) return fail(result.error, result.status)

  const fonts = await loadSocialFonts()
  const { width, height } = DIMENSIONS[size]

  return new ImageResponse(
    renderCard(result.card, { size, showUsernames: true }),
    {
      width,
      height,
      fonts,
      // Flag emoji are the one glyph class no text font reliably carries, and
      // both the tournament and every player lead with one.
      emoji: 'twemoji',
      headers: {
        // The picks on a locked bracket cannot change; only the points and
        // standing can, and those move when results are entered. Five minutes
        // keeps a share burst off the render path without printing a stale
        // score for long — a PNG render is expensive enough that an uncached
        // public URL is an invitation.
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
      },
    },
  )
}
