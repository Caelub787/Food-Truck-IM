import { callFunction } from '@/lib/supabase'

// Plaid's own window for logging in to a bank. The bank login happens there,
// never in this app, and Plaid only hands back a one time token that the
// server trades for read only access. https://plaid.com/docs/link/web/

type Handler = { open: () => void; destroy: () => void }
type PlaidGlobal = {
  create: (options: {
    token: string
    receivedRedirectUri?: string
    onSuccess: (publicToken: string, metadata: { institution?: { name?: string } | null }) => void
    onExit: (error: { display_message?: string | null; error_message?: string } | null) => void
  }) => Handler
}

const SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
const SAVED_TOKEN = 'plaid-link-token'

function loadPlaid(): Promise<PlaidGlobal> {
  const ready = (window as unknown as { Plaid?: PlaidGlobal }).Plaid
  if (ready) return Promise.resolve(ready)
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script')
    tag.src = SCRIPT
    tag.onload = () => resolve((window as unknown as { Plaid: PlaidGlobal }).Plaid)
    tag.onerror = () => reject(new Error("Couldn't open the bank window. Check your connection and try again."))
    document.head.appendChild(tag)
  })
}

function run(token: string, receivedRedirectUri?: string) {
  return loadPlaid().then(
    (Plaid) =>
      new Promise<'linked' | 'closed'>((resolve, reject) => {
        const handler = Plaid.create({
          token,
          receivedRedirectUri,
          onSuccess: (publicToken, metadata) => {
            handler.destroy()
            callFunction('bank', { action: 'exchange', public_token: publicToken, institution: metadata.institution?.name ?? '' })
              .then(() => resolve('linked'))
              .catch(reject)
          },
          onExit: (error) => {
            handler.destroy()
            if (error) reject(new Error(error.display_message || error.error_message || "The bank didn't connect. Please try again."))
            else resolve('closed')
          },
        })
        handler.open()
      }),
  )
}

/**
 * Links a new bank, or logs in again to one that asks (connectionId). The
 * demo has no Plaid, so its pretend server links a pretend bank instead.
 */
export async function linkBank(connectionId?: string): Promise<'linked' | 'closed'> {
  const { link_token, demo } = await callFunction<{ link_token?: string; demo?: boolean }>('bank', { action: 'link_token', connection_id: connectionId })
  if (demo) {
    await callFunction('bank', { action: 'exchange', public_token: 'demo', institution: 'Demo Bank' })
    return 'linked'
  }
  try {
    sessionStorage.setItem(SAVED_TOKEN, link_token!)
  } catch {
    // Only needed for banks that send people back here after logging in.
  }
  return run(link_token!)
}

/** Some banks log in on their own site and send people back with ?oauth_state_id. This picks up where it left off. */
export function finishBankRedirect(): Promise<'linked' | 'closed'> | null {
  if (!new URLSearchParams(window.location.search).has('oauth_state_id')) return null
  let token: string | null
  try {
    token = sessionStorage.getItem(SAVED_TOKEN)
  } catch {
    token = null
  }
  return token ? run(token, window.location.href) : null
}
