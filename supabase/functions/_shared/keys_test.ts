import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { pickKey } from './keys.ts'

const env = (values: Record<string, string>) => (name: string) => values[name]
const names = ['SUPABASE_SECRET_KEYS', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']

Deno.test('takes the default key from the newer JSON setting', () => {
  assertEquals(pickKey(names, env({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_a","other":"sb_secret_b"}' })), 'sb_secret_a')
  assertEquals(pickKey(names, env({ SUPABASE_SECRET_KEYS: '{"main":"sb_secret_c"}' })), 'sb_secret_c')
})

Deno.test('falls back to the plain and older key names', () => {
  assertEquals(pickKey(names, env({ SUPABASE_SECRET_KEY: 'sb_secret_d' })), 'sb_secret_d')
  assertEquals(pickKey(names, env({ SUPABASE_SECRET_KEYS: '{}', SUPABASE_SERVICE_ROLE_KEY: 'eyJold' })), 'eyJold')
})

Deno.test('says which setting is missing', () => {
  assertThrows(() => pickKey(names, env({})), Error, 'Missing setting: SUPABASE_SECRET_KEYS or')
})
