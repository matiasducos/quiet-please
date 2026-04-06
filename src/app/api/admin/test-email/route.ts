import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/test-email
 * Diagnostic endpoint — sends a test email to the current user.
 * Admin-only in production.
 * Returns detailed diagnostics at each step.
 */
export async function GET() {
  const diagnostics: string[] = []

  // 1. Check auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  diagnostics.push(`✅ Authenticated as ${user.id}`)

  // 2. Admin check in prod
  if (process.env.NODE_ENV !== 'development') {
    const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (!adminIds.includes(user.id)) {
      return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
    }
    diagnostics.push(`✅ Admin verified`)
  }

  // 3. Check RESEND_API_KEY
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    diagnostics.push(`❌ RESEND_API_KEY is not set`)
    return NextResponse.json({ diagnostics })
  }
  diagnostics.push(`✅ RESEND_API_KEY is set (${apiKey.slice(0, 6)}...${apiKey.slice(-4)})`)

  // 4. Check EMAIL_FROM
  const from = process.env.EMAIL_FROM ?? 'Quiet Please <notifications@quietplease.app>'
  diagnostics.push(`📧 FROM: ${from}`)

  // 5. Check user email
  const admin = createAdminClient()
  const { data: { user: authUser }, error: authErr } = await admin.auth.admin.getUserById(user.id)
  if (authErr) {
    diagnostics.push(`❌ Failed to fetch auth user: ${authErr.message}`)
    return NextResponse.json({ diagnostics })
  }
  if (!authUser?.email) {
    diagnostics.push(`❌ No email on auth user`)
    return NextResponse.json({ diagnostics })
  }
  diagnostics.push(`✅ User email: ${authUser.email}`)

  // 6. Check user prefs
  const { data: prefs, error: prefsErr } = await admin
    .from('users')
    .select('email_notifications, unsubscribe_token')
    .eq('id', user.id)
    .single()
  if (prefsErr) {
    diagnostics.push(`❌ Failed to fetch user prefs: ${prefsErr.message}`)
    return NextResponse.json({ diagnostics })
  }
  diagnostics.push(`✅ email_notifications: ${prefs?.email_notifications}`)
  diagnostics.push(`✅ unsubscribe_token: ${prefs?.unsubscribe_token ? 'set' : 'MISSING'}`)

  if (prefs?.email_notifications === false) {
    diagnostics.push(`⚠️ User has opted out of emails — would not send`)
    return NextResponse.json({ diagnostics })
  }

  // 7. Try sending a test email
  const resend = new Resend(apiKey)
  try {
    const { data, error } = await resend.emails.send({
      from,
      replyTo: 'support@quietplease.app',
      to: authUser.email,
      subject: 'Test email from Quiet Please',
      html: `
        <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
          <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
          <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">Test email ✅</h1>
          <p style="color:#6b6b6b;font-size:16px;">If you can read this, email delivery is working.</p>
          <p style="color:#6b6b6b;font-size:12px;margin-top:20px;">Sent at: ${new Date().toISOString()}</p>
        </div>`,
    })

    if (error) {
      diagnostics.push(`❌ Resend API error: ${JSON.stringify(error)}`)
    } else {
      diagnostics.push(`✅ Email sent successfully! Resend ID: ${data?.id}`)
    }
  } catch (e: any) {
    diagnostics.push(`❌ Exception sending email: ${e?.message ?? e}`)
  }

  return NextResponse.json({ diagnostics })
}
