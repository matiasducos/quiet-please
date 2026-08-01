import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Only use this in server-side code (API routes, cron jobs)
// Never expose to the client — uses service role key which bypasses RLS
// Singleton: reuse the same instance across calls within a serverless invocation
// to avoid creating redundant HTTP connections to PostgREST.
let _adminClient: ReturnType<typeof createClient<Database>> | null = null

export function createAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )
  }
  return _adminClient
}

/**
 * Paginate through all auth users. Returns the full list regardless of count.
 *
 * perPage is 25, NOT the GoTrue maximum of 1000: on this project
 * `GET /auth/v1/admin/users` returns `{"msg":"Database error finding users"}`
 * with zero users once per_page crosses somewhere in 31..39. Measured against
 * production, 100% reproducible, with only ~154 auth users:
 *
 *     per_page=30   -> 30 users  ✓
 *     per_page=39   ->  0 users  ✗ Database error finding users
 *     per_page=1000 ->  0 users  ✗
 *
 * Because this threw on every call, `if (error) throw error` propagated into
 * callers that swallow it — draw-open notifications were silently dead from
 * 2026-03-30 to 2026-08-01. 25 leaves margin under the observed boundary.
 *
 * This is a workaround, not a cure: a query failure at 154 users points at
 * something wrong Supabase-side and is worth a support ticket. Prefer querying
 * `public.users` (which carries email, prefs and unsubscribe_token) over this
 * function for anything that fans out to the whole user base — it avoids GoTrue
 * entirely and lets the filtering happen in the database.
 */
export async function listAllUsers(
  admin: ReturnType<typeof createAdminClient>,
): Promise<Array<{ id: string; email?: string; [key: string]: any }>> {
  const allUsers: any[] = []
  let page = 1
  const perPage = 25
  while (true) {
    const { data: { users }, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    allUsers.push(...users)
    if (users.length < perPage) break
    page++
  }
  return allUsers
}
