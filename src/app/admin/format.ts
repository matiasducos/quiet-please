/**
 * Pure formatting shared by the admin surfaces.
 *
 * Deliberately NOT in ui.tsx. That file is `'use client'`, which makes every one
 * of its exports a client reference — renderable as a component from the server,
 * but not callable. A server component doing `when(row.created_at)` therefore
 * fails at runtime with TypeScript none the wiser, which is exactly how the
 * banners page broke first time out.
 *
 * Nothing here touches the DOM or React, so there is no reason for it to be
 * client-only. ui.tsx re-exports both names so existing client callers are
 * unaffected.
 */

export const mono = { fontFamily: 'var(--font-mono)' } as const

/** Relative time, falling back to an absolute date past a day. */
export function when(iso: string | null) {
  if (!iso) return 'never'
  const d = new Date(iso)
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}
