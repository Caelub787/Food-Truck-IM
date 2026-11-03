import { useQueryClient } from '@tanstack/react-query'
import { Plus, Wallet } from 'lucide-react'
import { useState } from 'react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Button, Card, Field, Notice, Sheet } from '@/components/ui'
import { num } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { supabase } from '@/lib/supabase'
import { formatMoney } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { ago, useAccounts, type MoneyAccount } from './data'

/**
 * Money on hand: balances people type in, like a bank account or a cash box.
 * The app never connects to a bank, so no bank login or bank data is ever kept.
 */
export function MoneyCard() {
  const accounts = useAccounts()
  const [editing, setEditing] = useState<MoneyAccount | 'new' | null>(null)
  const all = accounts.data ?? []
  const total = all.reduce((sum, a) => sum + Number(a.balance ?? 0), 0)

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Money on hand</h2>
          <p className="text-3xl font-bold">{formatMoney(total)}</p>
          <p className="text-sm text-slate-500">Balances you type in. The app never connects to your bank.</p>
        </div>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <Plus className="size-5" aria-hidden /> Add an account
        </Button>
      </div>

      {all.length === 0 ? (
        <p className="mt-4 text-slate-500">Add your accounts and type in their balances, like your bank account or cash box.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {all.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setEditing(a)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-50">
                <span className="flex min-w-0 items-center gap-2">
                  <Wallet className="size-5 shrink-0 text-slate-400" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.name}</span>
                    <span className="text-sm text-slate-500">Updated {ago(a.balance_at)}</span>
                  </span>
                </span>
                <span className="font-semibold">{formatMoney(Number(a.balance ?? 0))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && <AccountSheet key={editing === 'new' ? 'new' : editing.id} account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function AccountSheet({ account, onClose }: { account: MoneyAccount | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(account?.name ?? '')
  const [balance, setBalance] = useState(account?.balance != null ? String(account.balance) : '')
  const done = async () => {
    await refreshTables(queryClient, ['money_accounts'])
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
