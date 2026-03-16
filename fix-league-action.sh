#!/bin/bash
set -e

cat > "src/app/leagues/new/actions.ts" << 'EOF'
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export async function createLeague(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const name = formData.get('name') as string
  const description = formData.get('description') as string
  if (!name?.trim()) return { error: 'League name is required' }

  // Use admin client to bypass RLS — we've already verified the user is authenticated
  const admin = createAdminClient()

  const { data: league, error: leagueError } = await admin
    .from('leagues')
    .insert({ name: name.trim(), description: description?.trim() || null, owner_id: user.id })
    .select()
    .single()

  if (leagueError) return { error: leagueError.message }

  await admin
    .from('league_members')
    .insert({ league_id: league.id, user_id: user.id })

  redirect(`/leagues/${league.id}`)
}
EOF

cat > "src/app/leagues/join/actions.ts" << 'EOF'
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export async function joinLeague(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const code = (formData.get('code') as string)?.toUpperCase().trim()
  if (!code) return { error: 'Please enter an invite code' }

  const admin = createAdminClient()

  const { data: league } = await admin
    .from('leagues')
    .select('id, name')
    .eq('invite_code', code)
    .eq('is_active', true)
    .single()

  if (!league) return { error: 'Invalid invite code. Check the code and try again.' }

  const { data: existing } = await admin
    .from('league_members')
    .select('league_id')
    .eq('league_id', league.id)
    .eq('user_id', user.id)
    .single()

  if (existing) redirect(`/leagues/${league.id}`)

  const { error: joinError } = await admin
    .from('league_members')
    .insert({ league_id: league.id, user_id: user.id })

  if (joinError) return { error: joinError.message }

  redirect(`/leagues/${league.id}`)
}
EOF

echo "✅ League actions fixed with admin client"
