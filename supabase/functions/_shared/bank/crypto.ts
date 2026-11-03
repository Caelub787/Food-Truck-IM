// Bank access tokens are locked with AES-GCM before they're saved, using a key
// that only exists as an Edge Function secret (BANK_TOKEN_KEY, 32 random bytes
// in base64). Even someone with a copy of the database can't use them.

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

async function importKey(keyB64: string) {
  const raw = fromB64(keyB64)
  if (raw.length !== 32) throw new Error('BANK_TOKEN_KEY must be 32 bytes in base64.')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** "iv.ciphertext", both in base64. */
export async function lockToken(token: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(keyB64), new TextEncoder().encode(token)))
  return `${toB64(iv)}.${toB64(sealed)}`
}

export async function unlockToken(locked: string, keyB64: string): Promise<string> {
  const [iv, sealed] = locked.split('.')
  if (!iv || !sealed) throw new Error('That bank link is damaged. Remove it and link the bank again.')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await importKey(keyB64), fromB64(sealed))
  return new TextDecoder().decode(plain)
}
