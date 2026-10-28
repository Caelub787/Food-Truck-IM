import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** False until the Supabase settings are filled in (see docs/SETUP.md). */
export const isConfigured = Boolean(url && key)

export const supabase: SupabaseClient = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  // Look up fetch on each call (the demo swaps in its own pretend server).
  global: { fetch: (input, init) => fetch(input, init) },
})

/** Calls an Edge Function and turns its error into a plain message. */
export async function callFunction<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const details = (await error.context.json().catch(() => null)) as { error?: string } | null
      throw new Error(details?.error ?? 'Something went wrong. Please try again.')
    }
    throw new Error('Could not reach the server. Check your connection and try again.')
  }
  return data as T
}

/** Calls a database function and throws its message if it fails. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
