// Web Push, the free way: no outside service, just the browser push servers
// (Google, Apple, Mozilla) and VAPID keys. Messages are encrypted for the
// device (RFC 8291, aes128gcm) and signed with our VAPID key (RFC 8292).
// Uses only the Web Crypto built into Deno.

export type Subscription = { endpoint: string; p256dh: string; auth: string }
export type VapidKeys = { publicKey: string; privateKey: string; subject: string }

const encoder = new TextEncoder()
type Bytes = Uint8Array<ArrayBuffer>

export function b64url(bytes: Bytes): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(text: string): Bytes {
  const s = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** The keys and nonce for one message (shared by encrypt and the test's decrypt). */
export async function deriveKeys(opts: {
  authSecret: Bytes
  sharedSecret: Bytes
  uaPublic: Bytes
  asPublic: Bytes
  salt: Bytes
}) {
  const prkKey = await hmac(opts.authSecret, opts.sharedSecret)
  const keyInfo = concat(encoder.encode('WebPush: info\0'), opts.uaPublic, opts.asPublic)
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])))
  const prk = await hmac(opts.salt, ikm)
  const cek = (await hmac(prk, concat(encoder.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, concat(encoder.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12)
  return { cek, nonce }
}

/** Encrypts a message for one device. Returns the request body. */
export async function encrypt(sub: Subscription, payload: string): Promise<Bytes> {
  const uaPublic = fromB64url(sub.p256dh)
  const authSecret = fromB64url(sub.auth)
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const { cek, nonce } = await deriveKeys({ authSecret, sharedSecret, uaPublic, asPublic, salt })

  const plain = concat(encoder.encode(payload), new Uint8Array([2])) // 2 = last (and only) record
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain))
  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  return concat(header, asPublic, cipher)
}

/** The signed "who's sending" token push servers ask for. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const pub = fromB64url(keys.publicKey)
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: keys.privateKey,
    x: b64url(pub.slice(1, 33)),
    y: b64url(pub.slice(33, 65)),
    ext: true,
  }
  const signer = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const head = b64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64url(
    encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })),
  )
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, encoder.encode(`${head}.${body}`)))
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${keys.publicKey}`
}

/**
 * Sends one notification. Returns 'gone' when the device unsubscribed (the
 * subscription should be deleted), 'ok' when it was accepted.
 */
export async function sendPush(sub: Subscription, message: Record<string, unknown>, keys: VapidKeys): Promise<'ok' | 'gone'> {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body: await encrypt(sub, JSON.stringify(message)),
  })
  await res.body?.cancel()
  if (res.status === 404 || res.status === 410) return 'gone'
  if (!res.ok) throw new Error(`Push failed with ${res.status}`)
  return 'ok'
}
