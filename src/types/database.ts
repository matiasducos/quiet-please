/**
 * Supabase Database type placeholder.
 *
 * Since the project is not linked locally (`supabase db push` won't work),
 * we can't auto-generate types via `supabase gen types typescript`.
 *
 * This placeholder allows TypeScript to compile while Supabase clients
 * infer types from the actual database at runtime. To regenerate real types:
 *
 *   npx supabase gen types typescript --project-id <project-id> > src/types/database.ts
 *
 * Or paste the output from the Supabase dashboard → API Docs → TypeScript types.
 */
export type Database = Record<string, any>

/** JSON-compatible value (matches Supabase's generated Json type) */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
