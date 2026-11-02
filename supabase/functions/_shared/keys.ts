// Supabase fills in the project's keys for every Edge Function. Newer projects
// have publishable and secret keys, sometimes given as JSON with a key per name
// (like {"default": "sb_secret_..."}). Older projects have the anon and service
// role keys. This takes the first one it finds, in the order given.
export function pickKey(names: string[], get: (name: string) => string | undefined = (n) => Deno.env.get(n)): string {
  for (const name of names) {
    const value = get(name)?.trim()
    if (!value) continue
    if (!value.startsWith('{')) return value
    try {
      const keys = JSON.parse(value) as Record<string, unknown>
      const found = keys.default ?? Object.values(keys).find((v) => typeof v === 'string' && v)
      if (typeof found === 'string' && found) return found
    } catch {
      // Not JSON after all. Try the next name.
    }
  }
  throw new Error(`Missing setting: ${names.join(' or ')}`)
}

export const publishableKey = () => pickKey(['SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'])
export const secretKey = () => pickKey(['SUPABASE_SECRET_KEYS', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
