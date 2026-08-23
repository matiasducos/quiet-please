import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '../../auth'
import { getLeague, listLeagueMembers } from '../actions'

export const metadata = { robots: { index: false, follow: false } }

const mono = { fontFamily: 'var(--font-mono)' } as const

function date(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

/**
 * Who is actually in one league.
 *
 * A server component rather than a filtered browser: there is nothing to filter
 * here, so paging through `?page=` costs a navigation instead of a round trip
 * plus a client bundle.
 *
 * `league_members` is readable only by that league's own members under RLS
 * (001, widened for public leagues in 020/049), so this route is the only way
 * an admin can see the roster of a private league — hence `requireAdmin()` and
 * the service-role RPC behind it.
 */
export default async function AdminLeagueDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const { page: pageParam } = await searchParams
  const page = Math.max(0, Number(pageParam ?? '0') || 0)

  const league = await getLeague(id)
  if (!league) notFound()

  const roster = await listLeagueMembers({ leagueId: id, page })

  const rangeFrom = roster.rows.length === 0 ? 0 : page * roster.pageSize + 1
  const rangeTo = page * roster.pageSize + roster.rows.length
  const hasMore = rangeTo < roster.total

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-6 py-4">
          <Link href="/admin/leagues" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Leagues
          </Link>
          <span style={{ ...mono, fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Roster
          </span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {league.name}
          </h1>
          {league.description && (
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem', lineHeight: 1.6 }}>
              {league.description}
            </p>
          )}
          <p style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.6rem', lineHeight: 1.8 }}>
            {league.isPublic ? 'public' : 'private'} · {league.isActive ? 'active' : 'inactive'} ·
            {' '}owned by {league.ownerUsername ?? 'unknown'}
            {!league.ownerIsMember && ' (not in the roster)'} ·
            {' '}invite code {league.inviteCode} ·
            {' '}created {date(league.createdAt)}
            {league.seasonStartDate && <> · season from {date(league.seasonStartDate)}</>}
          </p>
          {((league.allowedTournamentTypes?.length ?? 0) > 0 ||
            (league.allowedSurfaces?.length ?? 0) > 0) && (
            <p style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
              counts only:{' '}
              {(league.allowedTournamentTypes ?? []).join(', ')}
              {(league.allowedSurfaces?.length ?? 0) > 0 && (
                <> · {(league.allowedSurfaces ?? []).join(', ')}</>
              )}
            </p>
          )}
        </div>

        {roster.migrationMissing ? (
          <div className="rounded-sm border px-4 py-3" style={{ borderColor: '#fbbf24', background: '#fffbeb' }}>
            <p style={{ ...mono, fontSize: '0.75rem', color: '#92400e', lineHeight: 1.6 }}>
              This page needs a database function that isn&apos;t there yet. Run{' '}
              <strong>089_admin_league_overview.sql</strong> in the Supabase SQL editor, then reload.
            </p>
          </div>
        ) : (
          <>
            <p style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '12px' }}>
              {roster.total.toLocaleString()} member{roster.total === 1 ? '' : 's'} ·
              {' '}{league.totalPoints.toLocaleString()} league points between them
            </p>

            {roster.rows.length === 0 ? (
              <p style={{ ...mono, fontSize: '0.8rem', color: 'var(--muted)' }}>
                Nobody has joined this league.
              </p>
            ) : (
              /* Mobile first: the table scrolls inside its own container rather
                 than pushing the page sideways at 375px. */
              <div className="overflow-x-auto rounded-sm border bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
                <div className="min-w-[520px]">
                  <div
                    className="grid grid-cols-12 gap-2 px-3 py-2 border-b"
                    style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderColor: 'var(--chalk-dim)' }}
                  >
                    <div className="col-span-1">#</div>
                    <div className="col-span-4">Member</div>
                    <div className="col-span-2 text-right">League pts</div>
                    <div className="col-span-2 text-right">Ranking pts</div>
                    <div className="col-span-3 text-right">Joined</div>
                  </div>
                  {roster.rows.map((m, i) => (
                    <div
                      key={m.userId}
                      className="grid grid-cols-12 gap-2 px-3 py-2 border-b last:border-b-0 items-center"
                      style={{ ...mono, fontSize: '0.7rem', borderColor: 'var(--chalk-dim)' }}
                    >
                      <div className="col-span-1" style={{ color: 'var(--muted)' }}>
                        {page * roster.pageSize + i + 1}
                      </div>
                      <div className="col-span-4" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.username ?? <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>no username</span>}
                        {m.isOwner && (
                          <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: '9999px', marginLeft: '6px', color: 'var(--court)', background: '#eef4ff' }}>
                            owner
                          </span>
                        )}
                      </div>
                      <div className="col-span-2 text-right">{m.totalPoints.toLocaleString()}</div>
                      <div className="col-span-2 text-right" style={{ color: 'var(--muted)' }}>
                        {m.rankingPoints.toLocaleString()}
                      </div>
                      <div className="col-span-3 text-right" style={{ color: 'var(--muted)' }}>
                        {date(m.joinedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(page > 0 || hasMore) && (
              <div className="flex items-center gap-3 mt-6 flex-wrap">
                <Link
                  href={`/admin/leagues/${id}?page=${Math.max(0, page - 1)}`}
                  aria-disabled={page === 0}
                  className="px-3 py-1 rounded-sm border transition-opacity hover:opacity-70"
                  style={{ ...mono, fontSize: '0.7rem', borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white', pointerEvents: page === 0 ? 'none' : undefined, opacity: page === 0 ? 0.3 : 1 }}
                >
                  ← Prev
                </Link>
                <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)' }}>
                  {rangeFrom}–{rangeTo} of {roster.total.toLocaleString()}
                </span>
                <Link
                  href={`/admin/leagues/${id}?page=${page + 1}`}
                  aria-disabled={!hasMore}
                  className="px-3 py-1 rounded-sm border transition-opacity hover:opacity-70"
                  style={{ ...mono, fontSize: '0.7rem', borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white', pointerEvents: !hasMore ? 'none' : undefined, opacity: !hasMore ? 0.3 : 1 }}
                >
                  Next →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
