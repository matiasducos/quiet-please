/**
 * Generates an 8-character alphanumeric share code.
 * Uses an ambiguity-safe charset (no 0/O, 1/I/l confusion).
 * 54^8 ≈ 72 trillion combinations — collision-safe at any realistic scale.
 */
const CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz'

export function generateShareCode(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => CHARSET[b % CHARSET.length]).join('')
}
