// A small Plaid client: only what's needed to link a bank and read balances.
// Nothing here can move money. https://plaid.com/docs/api/

export type PlaidConfig = {
  clientId: string
  secret: string
  /** 'sandbox' for testing, 'production' for real banks (including Plaid's free Trial plan). */
  env: string
  /** Plaid products to ask for when linking. Balances come with any of them. */
  products: string[]
  /** Needed for banks that log in on their own site (OAuth). */
  redirectUri?: string
}

export type BankAccount = { account_id: string; name: string; mask: string | null; type: string; current: number | null; available: number | null }

export class PlaidError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export function plaid(config: PlaidConfig, fetcher: typeof fetch = fetch) {
  const base = `https://${config.env === 'production' ? 'production' : 'sandbox'}.plaid.com`
  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetcher(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: config.clientId, secret: config.secret, ...body }),
    })
    const data = await res.json()
    if (!res.ok) throw new PlaidError(data.error_code ?? 'UNKNOWN', data.display_message ?? data.error_message ?? 'The bank link service had a problem.')
    return data as T
  }

  return {
    /** A one time token for Plaid's window. With an access token, it's for logging in to a linked bank again. */
    linkToken: async (userId: string, accessToken?: string) =>
      (
        await post<{ link_token: string }>('/link/token/create', {
          client_name: 'Food Truck IM',
          user: { client_user_id: userId },
          country_codes: ['US'],
          language: 'en',
          ...(accessToken ? { access_token: accessToken } : { products: config.products }),
          ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
        })
      ).link_token,

    exchange: (publicToken: string) => post<{ access_token: string; item_id: string }>('/item/public_token/exchange', { public_token: publicToken }),

    accounts: async (accessToken: string): Promise<BankAccount[]> => {
      const data = await post<{
        accounts: { account_id: string; name: string; official_name: string | null; mask: string | null; type: string; balances: { current: number | null; available: number | null } }[]
      }>('/accounts/get', { access_token: accessToken })
      return data.accounts.map((a) => ({
        account_id: a.account_id,
        name: a.name || a.official_name || 'Account',
        mask: a.mask,
        type: a.type,
        current: a.balances.current,
        available: a.balances.available,
      }))
    },

    remove: (accessToken: string) => post('/item/remove', { access_token: accessToken }),
  }
}
