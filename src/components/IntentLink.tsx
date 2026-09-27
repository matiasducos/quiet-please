import Link from 'next/link'
import type { ComponentProps } from 'react'

/**
 * A `<Link>` that prefetches the WHOLE next page on hover, or on the touchstart
 * just before a tap — so the click lands on data already in the browser.
 *
 * Plain links only prefetch a dynamic route's shell, and most of this app's
 * routes are dynamic, so a normal click still waits on the server. This is
 * Next's `unstable_dynamicOnHover`.
 *
 * Use it ONLY on links that are few and almost always clicked once touched:
 * the tournament switcher, a page's main call to action. Each prefetch is a
 * full server render — a function invocation against the CPU budget — and on a
 * phone `touchstart` fires at the start of every scroll, so on a list of cards
 * it would render a page for every card a thumb lands on.
 *
 * Why a wrapper: the prop exists at runtime (the App Router aliases next/link to
 * next/dist/client/app-dir/link), but `next/link`'s published types are the
 * Pages Router's and omit it. One cast here instead of one per call site.
 */
export default function IntentLink(props: ComponentProps<typeof Link>) {
  const intent = { unstable_dynamicOnHover: true } as Record<string, unknown>
  return <Link {...props} {...intent} />
}
