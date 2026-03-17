import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const url = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  return NextResponse.redirect(new URL('/', url), { status: 303 })
}
