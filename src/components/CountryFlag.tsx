import { COUNTRIES, ALIASES } from '@/app/admin/countries'

const NAME_TO_CODE: Record<string, string> = {}
for (const c of COUNTRIES) {
  NAME_TO_CODE[c.name.toLowerCase()] = c.code.toLowerCase()
}
// Include aliases so api-tennis variants like "USA", "UK", "Czechia" resolve correctly
for (const [alias, code] of Object.entries(ALIASES)) {
  NAME_TO_CODE[alias.toLowerCase()] = code.toLowerCase()
}

/** Resolve a country name or ISO code to a lowercase 2-letter code */
function resolveCode(nameOrCode: string): string | null {
  const lower = nameOrCode.trim().toLowerCase()
  if (lower === 'world') return null
  // Already a 2-letter code?
  if (/^[a-z]{2}$/.test(lower)) return lower
  return NAME_TO_CODE[lower] ?? null
}

/**
 * Renders a country flag image from flagcdn.com.
 * Works on all platforms (Windows, Android, macOS, iOS) unlike Unicode flag emojis.
 */
export default function CountryFlag({
  country,
  size = 16,
  className,
}: {
  /** Country name (e.g. "Spain") or ISO 3166-1 alpha-2 code (e.g. "ES") */
  country: string
  /** Width in pixels (height is auto, aspect ratio ~4:3). Default: 16 */
  size?: number
  className?: string
}) {
  const code = resolveCode(country)
  if (!code) return null

  return (
    <img
      src={`https://flagcdn.com/w${size <= 20 ? 20 : 40}/${code}.png`}
      srcSet={`https://flagcdn.com/w${size <= 20 ? 40 : 80}/${code}.png 2x`}
      width={size}
      alt={country}
      title={country}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
      loading="lazy"
    />
  )
}

/**
 * Get the flagcdn URL for a country (for use in contexts where a component won't work,
 * like <option> elements in <select>).
 */
export function getFlagUrl(nameOrCode: string, size: 20 | 40 = 20): string | null {
  const code = resolveCode(nameOrCode)
  if (!code) return null
  return `https://flagcdn.com/w${size}/${code}.png`
}
