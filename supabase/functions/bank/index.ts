// Links banks with Plaid so the Budget page can show balances. Read only:
// nothing here can move money. Only people who can see the budget can use it.
//
// Settings (Edge Function secrets): PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV
// ('production' or 'sandbox'), BANK_TOKEN_KEY (32 random bytes in base64), and
// optionally PLAID_PRODUCTS (default 'transactions') and PLAID_REDIRECT_URI.
import { lockToken, unlockToken } from '../_shared/bank/crypto.ts'
import { plaid, PlaidError } from '../_shared/bank/plaid.ts'
import { adminClient, callerClient } from '../_shared/clients.ts'
import { corsHeaders, errorResponse, json, requireEnv, UserError } from '../_shared/http.ts'

type Body =
  | { action: 'status' }
  | { action: 'link_token'; connection_id?: string }
  | { action: 'exchange'; public_token: string; institution?: string }
  | { action: 'refresh' }
  | { action: 'remove'; connection_id: string }

const configured = () => Boolean(Deno.env.get('PLAID_CLIENT_ID') && Deno.env.get('PLAID_SECRET') && Deno.env.get('BANK_TOKEN_KEY'))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { client, user } = await callerClient(req)
    // Runs as the caller, so it stops anyone who can't see the budget.
    const { error: accessError } = await client.rpc('bank_connections')
    if (accessError) throw new UserError(accessError.message, 403)
    const { data: me, error: meError } = await client.rpc('my_context')
    if (meError) throw meError
    const company = (me as { company: { id: string } | null }).company?.id
    if (!company) throw new UserError('You do not have access to do this.', 403)

    const body = (await req.json()) as Body
    if (body.action === 'status') return json({ configured: configured() })
    if (!configured()) throw new UserError('Bank linking isn\'t set up yet. Type in balances instead, or see the setup guide.')

    const key = requireEnv('BANK_TOKEN_KEY')
    const bank = plaid({
      clientId: requireEnv('PLAID_CLIENT_ID'),
      secret: requireEnv('PLAID_SECRET'),
      env: Deno.env.get('PLAID_ENV') ?? 'sandbox',
      products: (Deno.env.get('PLAID_PRODUCTS') ?? 'transactions').split(',').map((p) => p.trim()).filter(Boolean),
      redirectUri: Deno.env.get('PLAID_REDIRECT_URI') || undefined,
    })
    const admin = adminClient()
    const links = async (connection?: string) => {
      const { data, error } = await admin.rpc('service_bank_list', { p_company: company, p_connection: connection ?? null })
      if (error) throw error
      return data as { id: string; item_id: string; access_token: string; institution: string | null }[]
    }
    // Reads one link's balances and saves them, or notes that the bank wants a new login.
    const sync = async (link: { id: string; access_token: string }) => {
      try {
        const accounts = await bank.accounts(await unlockToken(link.access_token, key))
        await admin.rpc('service_bank_update', { p_connection: link.id, p_accounts: accounts, p_status: 'ok' })
      } catch (e) {
        const needsLogin = e instanceof PlaidError && e.code === 'ITEM_LOGIN_REQUIRED'
        await admin.rpc('service_bank_update', {
          p_connection: link.id, p_accounts: [], p_status: needsLogin ? 'needs_login' : 'error',
          p_error: needsLogin ? 'The bank wants you to log in again.' : e instanceof Error ? e.message : String(e),
        })
      }
    }

    switch (body.action) {
      case 'link_token': {
        const [link] = body.connection_id ? await links(body.connection_id) : []
        if (body.connection_id && !link) throw new UserError('That bank link was not found.')
        const token = await bank.linkToken(`${company}:${user.id}`, link ? await unlockToken(link.access_token, key) : undefined)
        return json({ link_token: token })
      }
      case 'exchange': {
        const { access_token, item_id } = await bank.exchange(String(body.public_token))
        const institution = String(body.institution ?? '').slice(0, 120) || 'Bank'
        const locked = await lockToken(access_token, key)
        const { data: id, error } = await admin.rpc('service_bank_save', {
          p_company: company, p_user: user.id, p_item_id: item_id, p_token: locked, p_institution: institution,
        })
        if (error) throw error
        await sync({ id: id as string, access_token: locked })
        return json({ ok: true })
      }
      case 'refresh': {
        const all = await links()
        await Promise.all(all.map(sync))
        return json({ updated: all.length })
      }
      case 'remove': {
        const [link] = await links(body.connection_id)
        if (!link) throw new UserError('That bank link was not found.')
        await bank.remove(await unlockToken(link.access_token, key)).catch((e) => console.error('Plaid item/remove failed', e))
        const { error } = await admin.rpc('service_bank_remove', { p_company: company, p_connection: link.id })
        if (error) throw error
        return json({ ok: true })
      }
      default:
        throw new UserError('Unknown action.')
    }
  } catch (error) {
    if (error instanceof PlaidError) return errorResponse(new UserError(error.message))
    return errorResponse(error)
  }
})
