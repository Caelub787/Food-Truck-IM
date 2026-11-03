import { useState } from 'react'
import { Button, Card, Notice } from '@/components/ui'

/**
 * Makes the secret key that locks linked bank logins (BANK_TOKEN_KEY), right
 * here in the browser. It's never sent anywhere: the owner copies it into
 * Supabase (see docs/SETUP.md, the bank balances step).
 */
export function BankKeyCard() {
  const [key, setKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const make = () => setKey(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))
  const copy = async () => {
    await navigator.clipboard.writeText(key!)
    setCopied(true)
  }

  return (
    <Card>
      <h2 className="font-semibold">Bank link key</h2>
      <p className="mt-1 text-slate-600">
        Only needed if you set up bank balances for the Budget page. This key locks every bank login a business links. Make it once, then follow the bank
        balances step in docs/SETUP.md.
      </p>
      {key ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm font-medium text-slate-700">
            Key <span className="font-normal text-slate-500">(BANK_TOKEN_KEY in Supabase only. Keep it secret.)</span>
          </p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-3 text-sm">{key}</code>
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Notice tone="warning">This isn't saved anywhere. Copy it now. Once banks are linked, don't change it, or they'll all need to be linked again.</Notice>
        </div>
      ) : (
        <Button variant="secondary" className="mt-3" onClick={make}>
          Make a bank key
        </Button>
      )}
    </Card>
  )
}
