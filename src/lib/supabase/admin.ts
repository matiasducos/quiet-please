import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Only use this in server-side code (API routes, cron jobs)
// Never expose to the client — uses service role key which bypasses RLS
export function createAdminClient() {
  return createClient<Database>(
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

/**
 * Paginate through all auth users — GoTrue caps at 1000 per page.
 * Returns the full list regardless of user count.
 */
export async function listAllUsers(
  admin: ReturnType<typeof createAdminClient>,
): Promise<Array<{ id: string; email?: string; [key: string]: any }>> {
  const allUsers: any[] = []
  let page = 1
  const perPage = 1000
  while (true) {
    const { data: { users }, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    allUsers.push(...users)
    if (users.length < perPage) break
    page++
  }
  return allUsers
}
