import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { CountInput } from '@/components/CountInput'
import { Badge, Button, Field, Notice, Select, Sheet } from '@/components/ui'
import { useSupplyCatalog } from '@/features/setup/data'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { findUnit, formatAmount } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { daysUntil, movementLabels, useBatches, useMovements, usePeopleNames, usePlaces, useStockLevels } from './data'

/** Where a supply is, its expiration batches, its recent moves, and a quick adjustment. */
export function SupplyStockSheet({ supplyId, placeId, onClose }: { supplyId: string; placeId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const catalog = useSupplyCatalog()
  const levels = useStockLevels()
  const batches = useBatches()
  const places = usePlaces()
  const moves = useMovements({ supplyId, limit: 20 })
  const who = usePeopleNames()
  const supply = catalog.data?.supply(supplyId)
  const units = catalog.data?.unitsOf(supplyId) ?? []
  const unit = findUnit(units, supply?.count_unit_id)
  const [adjust, setAdjust] = useState<{ amount: number | null; direction: 'add' | 'remove'; reason: string }>({ amount: null, direction: 'remove', reason: '' })

  const saveAdjust = useAction(async () => {
    if (!adjust.amount) throw new Error('Enter an amount.')
    await rpc('adjust_stock', {
      p_place_id: placeId,
      p_supply_id: supplyId,
      p_quantity: (adjust.direction === 'add' ? 1 : -1) * adjust.amount * unit.factor,
      p_reason: adjust.reason,
    })
    setAdjust({ amount: null, direction: 'remove', reason: '' })
    await refreshTables(queryClient, ['stock_levels', 'stock_movements'])
  })
  const setDate = useAction(async (batchId: string, date: string) => {
    await rpc('set_batch_expiration', { p_batch_id: batchId, p_expires_on: date || null })
    await refreshTables(queryClient, ['stock_batches'])
  })

  if (!supply) return null
  const where = (levels.data ?? []).filter((l) => l.supply_id === supplyId && Number(l.quantity) !== 0)
  const myBatches = (batches.data ?? []).filter((b) => b.supply_id === supplyId && Number(b.quantity) > 0)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void saveAdjust.run()
  }

  return (
    <Sheet title={supply.name} open onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="font-semibold">Where it is</h3>
          {where.length === 0 && <p className="text-sm text-slate-500">None anywhere right now.</p>}
          <ul className="mt-2 divide-y divide-slate-100">
            {where.map((l) => (
              <li key={l.place_id} className="flex justify-between py-2">
                <span className={l.place_id === placeId ? 'font-semibold' : ''}>{places.name(l.place_id)}</span>
                <span className={Number(l.quantity) < 0 ? 'text-red-600' : ''}>{formatAmount(Number(l.quantity), unit)}</span>
              </li>
            ))}
          </ul>
        </section>

        {supply.tracks_expiration && (
          <section>
            <h3 className="font-semibold">Expiration dates</h3>
            <p className="text-sm text-slate-500">Used and loaded oldest first. Fix a date if it was entered wrong.</p>
            {setDate.error && <Notice tone="error">{setDate.error}</Notice>}
            <ul className="mt-2 divide-y divide-slate-100">
              {myBatches.map((b) => {
                const days = b.expires_on ? daysUntil(b.expires_on) : null
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-28 flex-1">
                      {places.name(b.place_id)}: {formatAmount(Number(b.quantity), unit)}
                    </span>
                    <input
                      type="date"
                      aria-label="Expiration date"
                      defaultValue={b.expires_on ?? ''}
                      key={b.expires_on ?? 'none'}
                      onBlur={(e) => e.target.value !== (b.expires_on ?? '') && void setDate.run(b.id, e.target.value)}
                      className="min-h-11 rounded-lg border border-slate-300 px-2"
                    />
                    {days !== null && days < 0 && <Badge tone="red">Expired</Badge>}
                    {days !== null && days >= 0 && days <= 3 && <Badge tone="amber">{days === 0 ? 'Today' : `${days} days`}</Badge>}
                    {days === null && <Badge>No date</Badge>}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <section>
          <h3 className="font-semibold">Adjust stock here</h3>
          <p className="text-sm text-slate-500">For something found or lost outside a count. It's logged with your name and reason.</p>
          <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
            {saveAdjust.error && <Notice tone="error">{saveAdjust.error}</Notice>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Change" value={adjust.direction} onChange={(e) => setAdjust({ ...adjust, direction: e.target.value as 'add' | 'remove' })}>
                <option value="remove">Take away</option>
                <option value="add">Add</option>
              </Select>
              <Field label="Reason" required placeholder="Found in back room" value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} />
            </div>
            <CountInput label="Amount" unit={unit.name} wholeOnly={supply.whole_only} value={adjust.amount} onChange={(v) => setAdjust({ ...adjust, amount: v })} />
            <Button type="submit" variant="secondary" busy={saveAdjust.busy}>
              Save adjustment
            </Button>
          </form>
        </section>

        <section>
          <h3 className="font-semibold">Recent moves</h3>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {(moves.data ?? []).map((m) => (
              <li key={m.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <strong>{movementLabels[m.kind]}</strong>{' '}
                  {[m.from_place_id && `from ${places.name(m.from_place_id)}`, m.to_place_id && `to ${places.name(m.to_place_id)}`].filter(Boolean).join(' ')}
                  {m.reason && <span className="text-slate-500"> ({m.reason})</span>}
                </span>
                <span className="text-slate-600">
                  {formatAmount(Number(m.quantity), unit)} · {who(m.created_by) || 'App'} · {new Date(m.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Sheet>
  )
}
