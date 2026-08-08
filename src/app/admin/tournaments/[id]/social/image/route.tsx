import { ImageResponse } from 'next/og'
import { assertAdmin } from '@/app/admin/auth'
import { loadSocialFonts } from '@/lib/social/fonts'
import { getSocialCard, CARD_KINDS, type CardKind } from '@/lib/social/data'
import { renderCard } from '@/lib/social/templates/cards'
import { DIMENSIONS, type CardSize } from '@/lib/social/templates/frame'

/**
 * Renders one social card as a PNG.
 *
 * This route is the *only* renderer. The admin studio previews a card by
 * pointing an <img> at this URL, so what is on screen is byte-identical to what
 * downloads — there is no second DOM implementation of the templates that could
 * drift away from the one that produces the file.
 *
 * Node runtime, not edge: the fonts are read off disk (see lib/social/fonts.ts).
 */
export const runtime = 'nodejs'
// Aggregates change the moment results are entered, and stale numbers here would
// be posted publicly. Correctness beats the render cost on an admin-only route.
export const dynamic = 'force-dynamic'

const SIZES: CardSize[] = ['story', 'square']

function isKind(v: string | null): v is CardKind {
  return !!v && (CARD_KINDS as readonly string[]).includes(v)
}

/** Plain-text errors, since the caller is an <img> that cannot render JSON. */
function fail(message: string, status: number): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain' } })
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await assertAdmin()
  } catch {
    return fail('Forbidden', 403)
  }

  const { id } = await ctx.params
  const url = new URL(req.url)

  const kindParam = url.searchParams.get('kind')
  if (!isKind(kindParam)) return fail(`Unknown card kind "${kindParam}"`, 400)

  const sizeParam = (url.searchParams.get('size') ?? 'story') as CardSize
  if (!SIZES.includes(sizeParam)) return fail(`Unknown size "${sizeParam}"`, 400)

  // `matches` absent means "no selection" (the card takes the round from the
  // top); `matches=` present but empty means the admin unticked everything, and
  // an empty card is the honest preview of that rather than a silent fallback to
  // the default five.
  const matchesParam = url.searchParams.get('matches')
  const matchIds = matchesParam == null ? undefined : matchesParam.split(',').filter(Boolean)

  const result = await getSocialCard(id, kindParam, {
    round: url.searchParams.get('round') ?? undefined,
    matchIds,
  })
  if (!result.ok) return fail(result.error, 422)

  const fonts = await loadSocialFonts()
  const { width, height } = DIMENSIONS[sizeParam]

  return new ImageResponse(
    renderCard(result.card, { size: sizeParam, showUsernames: url.searchParams.get('names') === '1' }),
    {
      width,
      height,
      fonts,
      // Flag emoji are the one glyph class no text font reliably carries, and
      // every tournament reference in this app leads with one. twemoji resolves
      // them to SVGs server-side, so they survive into the PNG.
      emoji: 'twemoji',
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
