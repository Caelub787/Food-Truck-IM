import { useState } from 'react'
import { Button, Card, Notice } from '@/components/ui'
import { pushKey } from '@/lib/push'

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * Makes the keys push notifications need, right here in the browser. They're
 * never sent anywhere: the owner copies them into Supabase and Cloudflare (see
 * docs/SETUP.md, Step 8).
 */
export function PushKeysCard() {
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const make = async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    setKeys({ publicKey: b64url(raw), privateKey: jwk.d! })
  }
  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(label)
  }

  return (
    <Card>
      <h2 className="font-semibold">Push notification keys</h2>
      {pushKey ? (
        <p className="mt-1 text-slate-600">Push notifications are set up. Only make new keys if the old private key got out.</p>
      ) : (
        <p className="mt-1 text-slate-600">Push notifications need two keys. Make them here, then follow Step 8 in docs/SETUP.md.</p>
      )}
      {keys ? (
        <div className="mt-3 space-y-3">
          {[
            ['Public key', keys.publicKey, 'VAPID_PUBLIC_KEY in Supabase and VITE_VAPID_PUBLIC_KEY in Cloudflare'],
            ['Private key', keys.privateKey, 'VAPID_PRIVATE_KEY in Supabase only. Keep it secret.'],
          ].map(([label, value, where]) => (
            <div key={label}>
              <p className="text-sm font-medium text-slate-700">
                {label} <span className="font-normal text-slate-500">({where})</span>
              </p>
              <div className="mt-1 flex gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-3 text-sm">{value}</code>
                <Button variant="secondary" onClick={() => void copy(label!, value!)}>
                  {copied === label ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          ))}
          <Notice tone="warning">These aren't saved anywhere. Copy both now. If you leave this page, make new ones.</Notice>
        </div>
      ) : (
        <Button variant="secondary" className="mt-3" onClick={() => void make()}>
          Make push keys
        </Button>
      )}
    </Card>
  )
}
