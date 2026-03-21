/**
 * Simple in-memory sliding-window rate limiter.
 * Works per serverless instance — not globally distributed,
 * but sufficient to prevent individual abuse without Redis.
 */

const hits = new Map<string, number[]>()

// Periodic cleanup to prevent memory leaks (every 60s, remove entries older than window)
let lastCleanup = Date.now()
const CLEANUP_INTERVAL = 60_000

function cleanup(windowMs: number) {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  const cutoff = now - windowMs
  for (const [key, timestamps] of hits) {
    const valid = timestamps.filter(t => t > cutoff)
    if (valid.length === 0) hits.delete(key)
    else hits.set(key, valid)
  }
}

/**
 * Check if a request should be rate-limited.
 * @returns `{ limited: false }` if allowed, `{ limited: true, retryAfter }` if blocked.
 */
export function rateLimit(
  key: string,
  { maxRequests = 10, windowMs = 60_000 }: { maxRequests?: number; windowMs?: number } = {},
): { limited: false } | { limited: true; retryAfter: number } {
  cleanup(windowMs)

  const now = Date.now()
  const cutoff = now - windowMs
  const timestamps = (hits.get(key) ?? []).filter(t => t > cutoff)

  if (timestamps.length >= maxRequests) {
    const oldestInWindow = timestamps[0]
    const retryAfter = Math.ceil((oldestInWindow + windowMs - now) / 1000)
    return { limited: true, retryAfter }
  }

  timestamps.push(now)
  hits.set(key, timestamps)
  return { limited: false }
}
