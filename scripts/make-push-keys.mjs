// Makes the two keys push notifications need (VAPID keys). Run it once:
//   node scripts/make-push-keys.mjs
// Then follow docs/SETUP.md to put them in Supabase and Cloudflare.
// The private key is a secret: never put it in the code or share it.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
const b64url = (bytes) => Buffer.from(bytes).toString('base64url')
console.log(`Public key  (VAPID_PUBLIC_KEY and VITE_VAPID_PUBLIC_KEY): ${b64url(raw)}`)
console.log(`Private key (VAPID_PRIVATE_KEY, Supabase only):           ${jwk.d}`)
