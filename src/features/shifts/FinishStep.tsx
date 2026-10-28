import { useState } from 'react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Badge, Button, Card, Notice, Select } from '@/components/ui'
import { newClientId } from '@/features/inventory/data'
import { winningGroup } from '@/features/sales/data'
import { friendlyError } from '@/lib/errors'
import { sendOrQueue } from '@/lib/offline'
import { findUnit, formatAmount } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import type { ShiftCtx } from './context'
import { sortSupplies } from './data'
import { ShiftResults } from './ShiftResults'
import { SupplyCards } from './SupplyCards'

const FINISH_TABLES = ['shifts', 'shift_results', 'stock_levels', 'stock_movements', 'stock_batches', 'flags']

/** After the ending count: send things back to the warehouse, then the Lead finishes. */
export function FinishStep({ ctx }: { ctx: ShiftCtx }) {
  const { shift, catalog: c } = ctx
  const locations = ctx.locations.filter((l) => l.active)
  const [toId, setTo] = useState('')
  const to = toId || ctx.truck?.home_location_id || locations[0]?.id || ''
  const [amounts, setAmounts] = useState<Record<string, number | null>>({})
  const [done, setDone] = useState<string | null>(null)
  const isManager = ctx.me.profile?.role !== 'driver'

  const lines = Object.entries(amounts)
    .filter(([, v]) => v && v > 0)
    .map(([supply_id, quantity]) => ({ supply_id, quantity }))

  const sendBack = useAction(async () => {
    if (lines.length === 0) throw new Error('Enter what is going back first.')
    const result = await sendOrQueue({
      fn: 'return_from_truck',
      args: { p: { shift_id: shift.id, location_id: to, client_id: newClientId(), lines } },
      tables: ['stock_levels', 'stock_movements', 'stock_batches'],
      label: 'Returning to the warehouse',
    }).catch((e: unknown) => {
      throw new Error(friendlyError(e))
    })
    setAmounts({})
    setDone(result === 'queued' ? "No signal. The return is saved on this phone and will send when you're back online." : `Sent ${lines.length} supplies back.`)
  })

  const finish = useAction(async () => {
    const result = await sendOrQueue({
      fn: 'finish_shift',
      args: { p_shift_id: shift.id, p_client_id: newClientId() },
      tables: FINISH_TABLES,
      label: 'Finish shift',
    }).catch((e: unknown) => {
      throw new Error(friendlyError(e))
    })
    if (result === 'queued') setDone("No signal. The shift will finish as soon as the phone is back online.")
  })

  if (shift.status === 'closed') {
    return (
      <div className="space-y-4">
        <Notice tone="success">
          Shift finished {shift.ended_at ? new Date(shift.ended_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''}.
          Here's what it used.
        </Notice>
        <ShiftResults shiftId={shift.id} catalog={c} showCost={isManager} compared={winningGroup(ctx.sales, ctx.settings)} />
      </div>
    )
  }
  if (shift.status === 'cancelled') return <Notice>This shift was cancelled.</Notice>
  if (!shift.end_confirmed_at) return <Notice>Finish the ending count first. Then send things back and finish the shift here.</Notice>

  // Things on the truck after the ending count that could go back.
  const endCount = (id: string) => Number(ctx.counts.find((x) => x.supply_id === id && x.kind === 'end')?.quantity ?? 0)
  const onTruckIds = sortSupplies(c, ctx.supplyIds).filter((s) => ctx.onTruck(s.id) > 0 || endCount(s.id) > 0)
  const returned = new Map<string, number>()
  for (const m of ctx.moves) {
    if (m.kind === 'return' && m.from_place_id === shift.truck_id && m.created_at > shift.end_confirmed_at) {
      returned.set(m.supply_id, (returned.get(m.supply_id) ?? 0) + Number(m.quantity))
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="font-semibold">Anything going back to the warehouse?</h3>
        <p className="text-slate-600">Things that shouldn't stay on the truck overnight (like milk or ice). Skip this if everything stays on.</p>
        {locations.length > 1 && (
          <Select label="Going back to" value={to} onChange={(e) => setTo(e.target.value)} className="mt-3 md:w-72">
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
      </Card>
      {done && <Notice tone="success">{done}</Notice>}
      <SupplyCards
        catalog={c}
        supplies={onTruckIds}
        value={(id) => amounts[id] ?? null}
        onChange={(id, base) => setAmounts({ ...amounts, [id]: base })}
        info={(s) => `On truck ${formatAmount(ctx.onTruck(s.id), findUnit(c.unitsOf(s.id), s.count_unit_id))}`}
        badge={(s) => (returned.has(s.id) ? <Badge tone="blue">Sent back</Badge> : null)}
      />
      {sendBack.error && <Notice tone="error">{sendBack.error}</Notice>}
      <Button variant="secondary" busy={sendBack.busy} disabled={lines.length === 0} onClick={() => void sendBack.run()}>
        Send these back
      </Button>

      {returned.size > 0 && (
        <Card>
          <h3 className="font-semibold">Sent back</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {sortSupplies(c, returned.keys()).map((s) => (
              <li key={s.id} className="flex justify-between gap-3 py-2">
                <span>{s.name}</span>
                <span className="font-medium">{formatAmount(returned.get(s.id)!, findUnit(c.unitsOf(s.id), s.count_unit_id))}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="sticky bottom-20 z-20 md:bottom-4">
        <Card className="flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <span className="text-slate-600">All done? Finishing works out what was used and saves it.</span>
          {finish.error && <Notice tone="error">{finish.error}</Notice>}
          {ctx.canLead ? (
            <ConfirmButton busy={finish.busy} confirmLabel="Tap again to finish" onConfirm={() => void finish.run()}>
              Finish shift
            </ConfirmButton>
          ) : (
            <span className="text-sm text-slate-500">{ctx.leadName} (the Lead) finishes the shift.</span>
          )}
        </Card>
      </div>
    </div>
  )
}
