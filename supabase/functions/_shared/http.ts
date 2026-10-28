export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** An error whose message is safe and friendly enough to show to the person using the app. */
export class UserError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof UserError) return json({ error: error.message }, error.status)
  console.error(error)
  return json({ error: 'Something went wrong. Please try again.' }, 500)
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing setting: ${name}`)
  return value
}
