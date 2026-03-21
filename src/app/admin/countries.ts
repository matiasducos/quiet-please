/** Country list with ISO 3166-1 alpha-2 codes.
 *  Flag emojis are generated from the code at render time
 *  using regional indicator symbols (U+1F1E6..U+1F1FF). */

export interface Country {
  code: string   // ISO 3166-1 alpha-2
  name: string
}

/** Convert a 2-letter country code to its flag emoji. */
export function codeToFlag(code: string): string {
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65),
  )
}

/**
 * Common aliases used by API-Tennis and other external data sources.
 * Maps alternative names → ISO 3166-1 alpha-2 codes.
 */
const ALIASES: Record<string, string> = {
  'usa': 'US', 'u.s.a.': 'US', 'u.s.': 'US', 'america': 'US',
  'uk': 'GB', 'great britain': 'GB', 'england': 'GB',
  'czechia': 'CZ',
  'korea': 'KR', 'republic of korea': 'KR',
  'chinese taipei': 'TW',
  'uae': 'AE',
  'bosnia and herzegovina': 'BA', 'bosnia': 'BA',
  'ivory coast': 'CI', "cote d'ivoire": 'CI',
  'north macedonia': 'MK', 'macedonia': 'MK',
  'trinidad and tobago': 'TT',
  'hong kong': 'HK',
  'puerto rico': 'PR',
}

/** Lookup map: country name (lowercase) → flag emoji. Built once on first call. */
const _nameToFlag = new Map<string, string>()
let _mapBuilt = false
function ensureMap() {
  if (_mapBuilt) return
  for (const c of COUNTRIES) _nameToFlag.set(c.name.toLowerCase(), codeToFlag(c.code))
  for (const [alias, code] of Object.entries(ALIASES)) {
    _nameToFlag.set(alias, codeToFlag(code))
  }
  _mapBuilt = true
}

/** Convert a full country name (e.g. "Spain", "USA") to its flag emoji, or null if not found.
 *  Returns null for special values like "World" (doubles teams / no nationality). */
export function nameToFlag(name: string | null | undefined): string | null {
  if (!name || name.toLowerCase() === 'world') return null
  ensureMap()
  return _nameToFlag.get(name.toLowerCase()) ?? null
}

// Comprehensive list of countries relevant to professional tennis
export const COUNTRIES: Country[] = [
  { code: 'AL', name: 'Albania' },
  { code: 'DZ', name: 'Algeria' },
  { code: 'AR', name: 'Argentina' },
  { code: 'AM', name: 'Armenia' },
  { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' },
  { code: 'AZ', name: 'Azerbaijan' },
  { code: 'BY', name: 'Belarus' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BA', name: 'Bosnia and Herzegovina' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'BR', name: 'Brazil' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'CA', name: 'Canada' },
  { code: 'CL', name: 'Chile' },
  { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'HR', name: 'Croatia' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'DK', name: 'Denmark' },
  { code: 'DO', name: 'Dominican Republic' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'EG', name: 'Egypt' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'EE', name: 'Estonia' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GE', name: 'Georgia' },
  { code: 'DE', name: 'Germany' },
  { code: 'GR', name: 'Greece' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IS', name: 'Iceland' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JM', name: 'Jamaica' },
  { code: 'JP', name: 'Japan' },
  { code: 'JO', name: 'Jordan' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LB', name: 'Lebanon' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MX', name: 'Mexico' },
  { code: 'MD', name: 'Moldova' },
  { code: 'MC', name: 'Monaco' },
  { code: 'MN', name: 'Mongolia' },
  { code: 'ME', name: 'Montenegro' },
  { code: 'MA', name: 'Morocco' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'MK', name: 'North Macedonia' },
  { code: 'NO', name: 'Norway' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'PE', name: 'Peru' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'QA', name: 'Qatar' },
  { code: 'RO', name: 'Romania' },
  { code: 'RU', name: 'Russia' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'RS', name: 'Serbia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'KR', name: 'South Korea' },
  { code: 'ES', name: 'Spain' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TN', name: 'Tunisia' },
  { code: 'TR', name: 'Turkey' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'UZ', name: 'Uzbekistan' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'ZW', name: 'Zimbabwe' },
]
