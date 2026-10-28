// Sends whatever is waiting in the outbox: emails, and push notifications to
// every phone or computer the person turned them on for. Supabase Cron calls
// this every minute (see supabase/setup/2-email-timer.sql) with a shared secret.
import { adminClient } from '../_shared/clients.ts'
import { sendMail } from '../_shared/email/mailer.ts'
import { renderTemplate } from '../_shared/email/templates.ts'
import { errorResponse, json, requireEnv } from '../_shared/http.ts'
import { sendPush, type Subscription, type VapidKeys } from '../_shared/push/webpush.ts'

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
        if (row.channel === 'push') {
          await deliverPush(admin, row)
        } else {
          const to = row.to_email ?? (await lookupEmail(admin, row.to_user))
          if (!to) throw new Error('No email address for this message.')
          await sendMail({ to, ...renderTemplate(row.template, row.payload, ctx) })
        }
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

function vapidKeys(): VapidKeys | null {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@example.com' }
}

/** Sends to each device the person has. Devices that unsubscribed are forgotten. */
async function deliverPush(admin: ReturnType<typeof adminClient>, row: OutboxRow) {
  const keys = vapidKeys()
  if (!keys) return // Push isn't set up yet (see docs/SETUP.md). Nothing to do.
  const { data, error } = await admin.rpc('service_push_targets', { p_user: row.to_user })
  if (error) throw error
  const message = { title: row.payload.title, body: row.payload.body, url: row.payload.url ?? '/' }
  let failures = 0
  for (const sub of (data ?? []) as Subscription[]) {
    try {
      if ((await sendPush(sub, message, keys)) === 'gone') await admin.rpc('service_drop_push', { p_endpoint: sub.endpoint })
    } catch {
      failures++
    }
  }
  if (failures > 0 && failures === (data ?? []).length) throw new Error('Push failed for every device.')
}
