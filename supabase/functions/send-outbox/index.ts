// Sends whatever is waiting in the outbox. Supabase Cron calls this every
// minute (see supabase/setup/cron.sql) with a shared secret.
import { adminClient } from '../_shared/clients.ts'
import { sendMail } from '../_shared/email/mailer.ts'
import { renderTemplate } from '../_shared/email/templates.ts'
import { errorResponse, json, requireEnv } from '../_shared/http.ts'

type OutboxRow = {
  id: string
  channel: 'email' | 'push'
  to_user: string | null
  to_email: string | null
  template: string
  payload: Record<string, unknown>
}

Deno.serve(async (req) => {
  try {
    if (req.headers.get('x-cron-secret') !== requireEnv('CRON_SECRET')) {
      return json({ error: 'Not allowed' }, 401)
    }
    const admin = adminClient()
    const ctx = {
      appName: Deno.env.get('APP_NAME') ?? 'TruckStock',
      siteUrl: requireEnv('SITE_URL').replace(/\/$/, ''),
    }

    await admin.rpc('service_requeue_stuck_outbox')
    const { data, error } = await admin.rpc('service_claim_outbox', { p_limit: 25 })
    if (error) throw error

    let sent = 0
    let failed = 0
    for (const row of (data ?? []) as OutboxRow[]) {
      try {
        if (row.channel !== 'email') throw new Error('Push notifications are not set up yet.')
        const to = row.to_email ?? (await lookupEmail(admin, row.to_user))
        if (!to) throw new Error('No email address for this message.')
        await sendMail({ to, ...renderTemplate(row.template, row.payload, ctx) })
        await admin.rpc('service_finish_outbox', { p_id: row.id, p_ok: true })
        sent++
      } catch (sendError) {
        await admin.rpc('service_finish_outbox', { p_id: row.id, p_ok: false, p_error: String(sendError) })
        failed++
      }
    }
    return json({ sent, failed })
  } catch (error) {
    return errorResponse(error)
  }
})

async function lookupEmail(admin: ReturnType<typeof adminClient>, userId: string | null) {
  if (!userId) return null
  const { data } = await admin.auth.admin.getUserById(userId)
  return data.user?.email ?? null
}
