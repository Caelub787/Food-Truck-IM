import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'
import { requireEnv, UserError } from './http.ts'

// Supabase fills these in for every Edge Function. The publishable and secret
// key names are the newer ones, the anon and service role names the older ones.
function publicKey() {
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? requireEnv('SUPABASE_ANON_KEY')
}
function secretKey() {
  return Deno.env.get('SUPABASE_SECRET_KEY') ?? requireEnv('SUPABASE_SERVICE_ROLE_KEY')
}

/** Uses the server key. Skips all security rules, so check who is asking first. */
export function adminClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Acts as the person who called the function, so security rules apply. */
export async function callerClient(req: Request): Promise<{ client: SupabaseClient; user: User }> {
  const authorization = req.headers.get('Authorization')
  if (!authorization) throw new UserError('Please log in again.', 401)
  const client = createClient(requireEnv('SUPABASE_URL'), publicKey(), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = authorization.replace(/^Bearer\s+/i, '')
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new UserError('Please log in again.', 401)
  return { client, user: data.user }
}
