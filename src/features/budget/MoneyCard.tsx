import { useQueryClient } from '@tanstack/react-query'
import { Landmark, Plus, RefreshCw, Wallet } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Badge, Button, Card, Field, Notice, Sheet } from '@/components/ui'
import { num } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { callFunction, supabase } from '@/lib/supabase'
import { formatMoney } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { ago, signedBalance, useAccounts, useBankLinks, useBankReady, type MoneyAccount } from './data'
import { finishBankRedirect, linkBank } from './plaidLink'

const STALE_MS = 6 * 3600_000
const MONEY_TABLES = ['money_accounts', 'bank_connections']

/**
 * Money on hand: balances typed in, and read only balances from linked banks.
 * The app can see bank balances. It can never move money.
 */
export function MoneyCard() {
  const queryClient = useQueryClient()
  const accounts = useAccounts()
  const links = useBankLinks()
  const ready = useBankReady()
  const [editing, setEditing] = useState<MoneyAccount | 'new' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const reload = () => refreshTables(queryClient, MONEY_TABLES)

  const refresh = useAction(async () => {
    await callFunction('bank', { action: 'refresh' })
    await reload()
  })
  const link = useAction(async (connectionId?: string) => {
    if ((await linkBank(connectionId)) === 'linked') {
      setNotice(connectionId ? 'Logged in again. Balances are up to date.' : 'Bank linked. Its balances are below.')
      await reload()
    }
  })
  const resume = useAction(async (finishing: Promise<'linked' | 'closed'>) => {
    if ((await finishing) === 'linked') {
      setNotice('Bank linked. Its balances are below.')
      await reload()
    }
  })
  const remove = useAction(async (connectionId: string) => {
    await callFunction('bank', { action: 'remove', connection_id: connectionId })
    await reload()
  })

  // Coming back from a bank that logs in on its own site.
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current) return
    resumed.current = true
    const finishing = finishBankRedirect()
    if (finishing) void resume.run(finishing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Bank balances update when the page opens, if they're more than a few hours old.
  const checked = useRef(false)
  useEffect(() => {
    if (checked.current || !links.data) return
    checked.current = true
    const ok = links.data.filter((l) => l.status === 'ok')
    if (ok.some((l) => !l.last_synced_at || Date.now() - Date.parse(l.last_synced_at) > STALE_MS)) void refresh.run()
  }, [links.data, refresh])

  const all = accounts.data ?? []
  const manual = all.filter((a) => a.kind === 'manual')
  const total = all.reduce((sum, a) => sum + signedBalance(a), 0)
  const error = link.error ?? resume.error ?? refresh.error ?? remove.error

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Money on hand</h2>
          <p className="text-3xl font-bold">{formatMoney(total)}</p>
          <p className="text-sm text-slate-500">View only. No money moves through the app.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ready.data && (
            <Button busy={link.busy} onClick={() => void link.run()}>
              <Landmark className="size-5" aria-hidden /> Link a bank
            </Button>
          )}
          <Button variant="secondary" onClick={() => setEditing('new')}>
            <Plus className="size-5" aria-hidden /> Add an account
          </Button>
        </div>
      </div>
      {notice && (
        <div className="mt-3">
          <Notice tone="success">{notice}</Notice>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {(links.data ?? []).map((l) => (
          <section key={l.id} className="rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <Landmark className="size-5 text-slate-400" aria-hidden />
                <span className="font-semibold">{l.institution ?? 'Bank'}</span>
                {l.status === 'needs_login' && <Badge tone="amber">Needs a new login</Badge>}
                {l.status === 'error' && <Badge tone="red">Couldn't update</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-sm text-slate-500">Updated {ago(l.last_synced_at)}</span>
                {l.status === 'needs_login' ? (
                  <Button variant="ghost" busy={link.busy} onClick={() => void link.run(l.id)}>
                    Log in again
                  </Button>
                ) : (
                  <Button variant="ghost" busy={refresh.busy} onClick={() => void refresh.run()} aria-label="Update balances">
                    <RefreshCw className="size-4" aria-hidden />
                  </Button>
                )}
                <ConfirmButton variant="ghost" confirmLabel="Tap again to unlink" busy={remove.busy} onConfirm={() => void remove.run(l.id)}>
                  Unlink
                </ConfirmButton>
              </div>
            </div>
            <ul className="divide-y divide-slate-100">
              {all
                .filter((a) => a.connection_id === l.id)
                .map((a) => (
                  <li key={a.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="text-sm text-slate-500">
                        {a.mask ? `ending in ${a.mask}` : a.account_type}
                        {a.available != null && a.account_type !== 'credit' && ` · ${formatMoney(Number(a.available))} available`}
                      </span>
                    </span>
                    <span className={`font-semibold ${signedBalance(a) < 0 ? 'text-red-600' : ''}`}>{formatMoney(signedBalance(a))}</span>
                  </li>
                ))}
            </ul>
          </section>
        ))}

        {manual.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {manual.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setEditing(a)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-50">
                  <span className="flex min-w-0 items-center gap-2">
                    <Wallet className="size-5 shrink-0 text-slate-400" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="text-sm text-slate-500">Typed in {ago(a.balance_at)}</span>
                    </span>
                  </span>
                  <span className="font-semibold">{formatMoney(Number(a.balance ?? 0))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {all.length === 0 && (links.data ?? []).length === 0 && (
          <p className="text-slate-500">
            {ready.data
              ? 'Link a bank to see its balances here, or add an account and type in the balance (like a cash box).'
              : 'Add an account and type in its balance, like your bank account or cash box.'}
          </p>
        )}
      </div>

      {editing && <AccountSheet key={editing === 'new' ? 'new' : editing.id} account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function AccountSheet({ account, onClose }: { account: MoneyAccount | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(account?.name ?? '')
  const [balance, setBalance] = useState(account?.balance != null ? String(account.balance) : '')
  const done = async () => {
    await refreshTables(queryClient, MONEY_TABLES)
    onClose()
  }
  const save = useAction(async () => {
    const amount = num(balance)
    if (amount === null) throw new Error('Enter the balance.')
    const row = { name: name.trim(), balance: amount, balance_at: new Date().toISOString() }
    const { error } = account ? await supabase.from('money_accounts').update(row).eq('id', account.id) : await supabase.from('money_accounts').insert(row)
    if (error) throw error
    await done()
  })
  const remove = useAction(async () => {
    const { error } = await supabase.from('money_accounts').delete().eq('id', account!.id)
    if (error) throw error
    await done()
  })

  return (
    <Sheet title={account ? account.name : 'Add an account'} open onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save.run()
        }}
      >
        <Field label="Name" required placeholder="Checking, cash box, savings" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <Field label="Balance right now ($)" required inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} hint="Type in a new balance any time it changes." />
        {(save.error || remove.error) && <Notice tone="error">{save.error ?? remove.error}</Notice>}
        <Button type="submit" busy={save.busy} full>
          Save
        </Button>
        {account && (
          <ConfirmButton variant="secondary" confirmLabel="Tap again to remove it" busy={remove.busy} onConfirm={() => void remove.run()} full>
            Remove this account
          </ConfirmButton>
        )}
      </form>
    </Sheet>
  )
}
