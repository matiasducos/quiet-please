import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Font binaries for Satori (the renderer behind `next/og`'s ImageResponse).
 *
 * Satori has no access to system fonts and no font fallback chain of its own.
 * A `fontFamily: 'DM Serif Display, Georgia, serif'` is not a request it can
 * satisfy — it matches the name against the fonts handed to it and silently
 * falls back to its bundled Noto Sans otherwise. So every face we reference in
 * a template has to be loaded here, as raw bytes, or the card renders in the
 * wrong typeface without erroring.
 *
 * These are the same four faces the app itself loads through `next/font/google`
 * in src/app/layout.tsx, downloaded as static instances.
 */
const FONT_DIR = path.join(process.cwd(), 'src/lib/social/fonts')

/** Family names templates reference. Kept as constants so a typo fails loudly at build. */
export const DISPLAY = 'DM Serif Display'
export const BODY = 'DM Sans'
export const MONO = 'DM Mono'

type SatoriFont = {
  name: string
  data: ArrayBuffer
  weight: 400 | 500 | 700
  style: 'normal'
}

const FILES: Array<{ file: string; name: string; weight: 400 | 500 | 700 }> = [
  { file: 'DMSerifDisplay-Regular.ttf', name: DISPLAY, weight: 400 },
  { file: 'DMSans-Regular.ttf', name: BODY, weight: 400 },
  { file: 'DMSans-Bold.ttf', name: BODY, weight: 700 },
  { file: 'DMMono-Medium.ttf', name: MONO, weight: 500 },
]

/**
 * Read once per process, not once per image. A warm lambda rendering a story
 * and a square back-to-back should not hit the filesystem twice, and caching
 * the promise (rather than the result) collapses concurrent first calls too.
 */
let cached: Promise<SatoriFont[]> | null = null

export function loadSocialFonts(): Promise<SatoriFont[]> {
  cached ??= Promise.all(
    FILES.map(async ({ file, name, weight }) => ({
      name,
      weight,
      style: 'normal' as const,
      // Node's Buffer is a view onto a possibly-larger pool, so `.buffer` alone
      // can hand Satori neighbouring allocations. Slice to this file's bytes.
      data: await readFile(path.join(FONT_DIR, file)).then(
        b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer,
      ),
    })),
  )
  return cached
}
