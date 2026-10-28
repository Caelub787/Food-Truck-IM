// Invites a person to the caller's business, resends an invite, or cancels one.
//
// The caller's permissions are checked twice: can_invite() runs as the caller
// (security rules apply), and service_add_member() checks again on the server.
import { adminClient, callerClient } from '../_shared/clients.ts'
import { corsHeaders, errorResponse, json, requireEnv, UserError } from '../_shared/http.ts'

type Body =
  | { action: 'invite'; email: string; full_name: string; role: 'admin' | 'manager' | 'driver' }
  | { action: 'cancel'; user_id: string }

type InviteCheck = { action: 'invite' | 'resend' | 'attach'; user_id?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { client, user } = await callerClient(req)
    const body = (await req.json()) as Body
    const admin = adminClient()

    if (body.action === 'cancel') {
      const { error } = await admin.rpc('service_cancel_invite', { p_actor: user.id, p_user_id: body.user_id })
      if (error) throw new UserError(error.message)
      const { error: deleteError } = await admin.auth.admin.deleteUser(body.user_id)
      if (deleteError) console.error('Could not delete login after cancelling invite', deleteError)
      return json({ ok: true })
    }

    if (body.action !== 'invite') throw new UserError('Unknown action.')
    const email = String(body.email ?? '').trim().toLowerCase()
    const fullName = String(body.full_name ?? '').trim()
    if (!fullName) throw new UserError('Please enter their name.')

    const { data: check, error: checkError } = await client.rpc('can_invite', { p_email: email, p_role: body.role })
    if (checkError) throw new UserError(checkError.message)
    const plan = check as InviteCheck

    if (plan.action === 'attach') {
      // They already have a confirmed login, so add them and let them know.
      const { error } = await admin.rpc('service_add_member', {
        p_actor: user.id,
        p_user_id: plan.user_id,
        p_email: email,
        p_full_name: fullName,
        p_role: body.role,
        p_joined: true,
      })
      if (error) throw new UserError(error.message)
      await notifyAdded(admin, user.id, plan.user_id!, email, fullName)
      return json({ ok: true, action: 'attach' })
    }

    // New person, or resending to someone who hasn't joined yet. Supabase sends
    // the invite email (through the Gmail account set up in Auth settings).
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${requireEnv('SITE_URL')}/set-password`,
      data: { full_name: fullName },
    })
    if (inviteError || !invited.user) {
      throw new UserError(inviteError?.message ?? 'The invite email could not be sent. Please try again.')
    }

    const { error: addError } = await admin.rpc('service_add_member', {
      p_actor: user.id,
      p_user_id: invited.user.id,
      p_email: email,
      p_full_name: fullName,
      p_role: body.role,
      p_joined: false,
    })
    if (addError) {
      // Don't leave a login behind with no business.
      if (plan.action === 'invite') await admin.auth.admin.deleteUser(invited.user.id)
      throw new UserError(addError.message)
    }
    return json({ ok: true, action: plan.action })
  } catch (error) {
    return errorResponse(error)
  }
})

async function notifyAdded(
  admin: ReturnType<typeof adminClient>,
  actorId: string,
  userId: string,
  email: string,
  fullName: string,
) {
  const { data: actor } = await admin
    .from('profiles')
    .select('full_name, company_id, companies(name)')
    .eq('user_id', actorId)
    .single()
  if (!actor) return
  const companyName = (actor.companies as unknown as { name: string } | null)?.name ?? 'your business'
  await admin.from('outbox').insert({
    company_id: actor.company_id,
    channel: 'email',
    to_user: userId,
    to_email: email,
    template: 'added_to_company',
    payload: { full_name: fullName, company_name: companyName, invited_by_name: actor.full_name },
  })
}
