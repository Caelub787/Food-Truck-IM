import { assertEquals, assertNotEquals, assertRejects } from 'jsr:@std/assert@1'
import { lockToken, unlockToken } from './crypto.ts'
import { plaid, PlaidError } from './plaid.ts'

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))

Deno.test('bank tokens are locked and only open with the same key', async () => {
  const locked = await lockToken('access-sandbox-123', key)
  assertNotEquals(locked, 'access-sandbox-123')
  assertEquals(locked.includes('access'), false)
  assertEquals(await unlockToken(locked, key), 'access-sandbox-123')
  assertNotEquals(await lockToken('access-sandbox-123', key), locked)
  await assertRejects(() => unlockToken(locked, otherKey))
  await assertRejects(() => lockToken('x', btoa('short')), Error, '32 bytes')
})

Deno.test('the Plaid client sends the keys, reads balances, and passes on bank errors', async () => {
  const sent: { url: string; body: Record<string, unknown> }[] = []
  const fake = ((url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    sent.push({ url, body })
    if (url.endsWith('/accounts/get') && body.access_token === 'bad') {
      return Promise.resolve(new Response(JSON.stringify({ error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login again' }), { status: 400 }))
    }
    const replies: Record<string, unknown> = {
      '/link/token/create': { link_token: 'link-1' },
      '/accounts/get': { accounts: [{ account_id: 'a1', name: 'Checking', official_name: null, mask: '1234', type: 'depository', balances: { current: 10.5, available: 9 } }] },
    }
    return Promise.resolve(new Response(JSON.stringify(replies[new URL(url).pathname] ?? {}), { status: 200 }))
  }) as typeof fetch
  const client = plaid({ clientId: 'id', secret: 'sec', env: 'production', products: ['transactions'], redirectUri: 'https://app.example.com/budget' }, fake)

  assertEquals(await client.linkToken('company:user'), 'link-1')
  assertEquals(sent[0]!.url, 'https://production.plaid.com/link/token/create')
  assertEquals(sent[0]!.body.client_id, 'id')
  assertEquals(sent[0]!.body.products, ['transactions'])
  assertEquals(sent[0]!.body.redirect_uri, 'https://app.example.com/budget')
  await client.linkToken('company:user', 'access-1')
  assertEquals(sent[1]!.body.access_token, 'access-1')
  assertEquals(sent[1]!.body.products, undefined)

  assertEquals(await client.accounts('good'), [{ account_id: 'a1', name: 'Checking', mask: '1234', type: 'depository', current: 10.5, available: 9 }])
  const error = await assertRejects(() => client.accounts('bad'), PlaidError)
  assertEquals(error.code, 'ITEM_LOGIN_REQUIRED')
})
