import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { b64url, deriveKeys, encrypt, fromB64url, vapidAuthorization } from './webpush.ts'

// Acts as the phone: makes a subscription, then decrypts what we'd send it.
async function fakeDevice() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { pair, uaPublic, auth, sub: { endpoint: 'https://push.example.com/x', p256dh: b64url(uaPublic), auth: b64url(auth) } }
}

Deno.test('a device can decrypt what we send it', async () => {
  const device = await fakeDevice()
  const body = await encrypt(device.sub, JSON.stringify({ title: 'Low on cups' }))
  const salt = body.slice(0, 16)
  assertEquals(new DataView(body.buffer).getUint32(16), 4096)
  const idlen = body[20]!
  const asPublic = body.slice(21, 21 + idlen)
  const cipher = body.slice(21 + idlen)
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, device.pair.privateKey, 256))
  const { cek, nonce } = await deriveKeys({ authSecret: device.auth, sharedSecret: shared, uaPublic: device.uaPublic, asPublic, salt })
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher))
  assertEquals(plain[plain.length - 1], 2)
  assertEquals(new TextDecoder().decode(plain.slice(0, -1)), '{"title":"Low on cups"}')
})

Deno.test('the VAPID token is signed with our key and checks out', async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { publicKey, privateKey: jwk.d!, subject: 'mailto:a@b.c' })
  assertStringIncludes(header, `k=${publicKey}`)
  const token = header.slice('vapid t='.length, header.indexOf(','))
  const [h, b, s] = token.split('.')
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(b!)))
  assertEquals(claims.aud, 'https://fcm.googleapis.com')
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, fromB64url(s!), new TextEncoder().encode(`${h}.${b}`))
  assertEquals(ok, true)
})
