// Deletes photos older than each business keeps them (Business settings,
// "Keep photos for"), so the free storage plan doesn't fill up. Supabase Cron
// calls this once a day with a shared secret (see supabase/setup/3-jobs-timer.sql).
import { adminClient } from '../_shared/clients.ts'
import { errorResponse, json, requireEnv } from '../_shared/http.ts'

Deno.serve(async (req) => {
  try {
    if (req.headers.get('x-cron-secret') !== requireEnv('CRON_SECRET')) {
      return json({ error: 'Not allowed' }, 401)
    }
    const admin = adminClient()
    let removed = 0
    for (let round = 0; round < 10; round++) {
      const { data, error } = await admin.rpc('service_old_photos', { p_limit: 200 })
      if (error) throw error
      const paths = ((data ?? []) as { path: string }[]).map((r) => r.path)
      if (paths.length === 0) break
      const { error: removeError } = await admin.storage.from('photos').remove(paths)
      if (removeError) throw removeError
      const { error: forgetError } = await admin.rpc('service_forget_photos', { p_paths: paths })
      if (forgetError) throw forgetError
      removed += paths.length
    }
    return json({ removed })
  } catch (error) {
    return errorResponse(error)
  }
})
