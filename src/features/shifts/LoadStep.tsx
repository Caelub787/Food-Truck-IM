import { CheckSquare, Square } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, Notice, Select } from '@/components/ui'
import { newClientId } from '@/features/inventory/data'
import { useRows } from '@/lib/data'
import { friendlyError } from '@/lib/errors'
import { sendOrQueue } from '@/lib/offline'
import { findUnit, formatAmount } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import type { ShiftCtx } from './context'
import { sortSupplies, suggestedLoad, useShiftChecklist } from './data'
import { ActionBar, SupplyCards } from './SupplyCards'

const LOAD_TABLES = ['stock_levels', 'stock_movements', 'stock_batches']

/** Loading the truck from the warehouse, filled in to get back up to par levels. */
export function LoadStep({ ctx }: { ctx: ShiftCtx }) {
  const { shift, catalog: c } = ctx
  const locations = ctx.locations.filter((l) => l.active)
  const [fromId, setFrom] = useState('')
  const from = fromId || ctx.truck?.home_location_id || locations[0]?.id || ''
  const [amounts, setAmounts] = useState<Record<string, number | null>>({})
  const [added, setAdded] = useState<string[]>([])
  const [done, setDone] = useState<string | null>(null)

  const pars = ctx.pars.filter((p) => p.truck_id === shift.truck_id && Number(p.par_quantity) > 0)
  const parOf = (id: string) => Number(pars.find((p) => p.supply_id === id)?.par_quantity ?? 0)
  const ids = new Set([...pars.map((p) => p.supply_id), ...ctx.supplyIds, ...added])
  const supplies = sortSupplies(c, ids)
  const addable = c.supplies
    .filter((s) => s.active && !ids.has(s.id))
    .filter((s) => !s.truck_type_id || s.truck_type_id === ctx.truck?.truck_type_id)
    .sort((a, b) => a.name.localeCompare(b.name))

  // Suggestions are rounded up to whole count units (a whole jug, a whole sleeve).
  const suggestion = (id: string) => {
    const s = c.supply(id)!
    const unit = findUnit(c.unitsOf(id), s.count_unit_id)
    const need = suggestedLoad(parOf(id), ctx.onTruck(id))
    return need > 0 ? Math.ceil(need / unit.factor - 0.0001) * unit.factor : 0
  }
  const amount = (id: string) => (id in amounts ? amounts[id]! : suggestion(id))
  const lines = supplies.map((s) => ({ supply_id: s.id, quantity: amount(s.id) ?? 0 })).filter((l) => l.quantity > 0)

  const load = useAction(async () => {
    if (lines.length === 0) throw new Error('Enter how much you are loading first.')
    const result = await sendOrQueue({
      fn: 'load_truck',
      args: { p: { shift_id: shift.id, location_id: from, client_id: newClientId(), lines } },
      tables: LOAD_TABLES,
      label: 'Loading the truck',
    }).catch((e: unknown) => {
      throw new Error(friendlyError(e))
    })
    setAmounts({})
    setAdded([])
    setDone(result === 'queued' ? "No signal. The load is saved on this phone and will send when you're back online." : `Loaded ${lines.length} supplies.`)
  })

  if (!shift.start_confirmed_at) return <Notice>Confirm the starting count first, then load up.</Notice>

  const loaded = new Map<string, number>()
  for (const m of ctx.moves) if (m.kind === 'load' && m.to_place_id === shift.truck_id) loaded.set(m.supply_id, (loaded.get(m.supply_id) ?? 0) + Number(m.quantity))
  const open = shift.status === 'open' && !shift.end_confirmed_at

  return (
    <div className="space-y-4">
      {open && (
        <>
          {pars.length === 0 ? (
            <Notice>
              This truck has no par levels yet, so nothing is filled in. A manager can set them in Setup, under Trucks. Enter what you're loading
              below.
            </Notice>
          ) : (
            <Notice>Amounts are filled in to bring the truck back up to its par levels. Change anything you load differently.</Notice>
          )}
          {done && <Notice tone="success">{done}</Notice>}
          {locations.length > 1 && (
            <Select label="Loading from" value={from} onChange={(e) => setFrom(e.target.value)} className="md:w-72">
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
          <SupplyCards
            catalog={c}
            supplies={supplies}
            value={amount}
            onChange={(id, base) => setAmounts({ ...amounts, [id]: base })}
            info={(s) => {
              const unit = findUnit(c.unitsOf(s.id), s.count_unit_id)
              const par = parOf(s.id)
              const inStock = ctx.at(from, s.id)
              return (
                <>
                  On truck {formatAmount(ctx.onTruck(s.id), unit)}
                  {par > 0 && <> · par {formatAmount(par, unit)}</>}
                  <br />
                  <span className={(amount(s.id) ?? 0) > inStock ? 'font-medium text-amber-700' : ''}>
                    {ctx.locations.find((l) => l.id === from)?.name ?? 'Warehouse'} has {formatAmount(inStock, unit)}
                  </span>
                </>
              )
            }}
            badge={(s) => (loaded.has(s.id) ? <Badge tone="blue">Loaded</Badge> : null)}
            addable={addable}
            onAdd={(id) => setAdded([...added, id])}
          />
        </>
      )}

      {loaded.size > 0 && (
        <Card>
          <h3 className="font-semibold">Loaded on this shift</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {sortSupplies(c, loaded.keys()).map((s) => (
              <li key={s.id} className="flex justify-between gap-3 py-2">
                <span>{s.name}</span>
                <span className="font-medium">{formatAmount(loaded.get(s.id)!, findUnit(c.unitsOf(s.id), s.count_unit_id))}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Checklist ctx={ctx} />

      {open && (
        <ActionBar>
          <span className="text-slate-600">{lines.length === 0 ? 'Nothing to load' : `${lines.length} supplies to load`}</span>
          {load.error && <Notice tone="error">{load.error}</Notice>}
          <Button busy={load.busy} disabled={lines.length === 0 || !from} onClick={() => void load.run()}>
            Load these
          </Button>
        </ActionBar>
      )}
    </div>
  )
}

type ChecklistItem = { id: string; name: string; truck_type_id: string | null; active: boolean; sort: number }

/** The loading checklist (if the business uses one). Anyone on the shift can tick items. */
function Checklist({ ctx }: { ctx: ShiftCtx }) {
  const { shift } = ctx
  const items = useRows<ChecklistItem>('checklist_items', { order: 'sort,name' })
  const checked = useShiftChecklist(shift.id)
  const [local, setLocal] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  if (!ctx.settings?.loading_checklist_enabled) return null
  const list = (items.data ?? []).filter((i) => i.active && (!i.truck_type_id || i.truck_type_id === ctx.truck?.truck_type_id))
  if (list.length === 0) return null
  const isChecked = (id: string) => (id in local ? local[id]! : Boolean(checked.data?.some((r) => r.item_id === id)))
  const doneCount = list.filter((i) => isChecked(i.id)).length
  const editable = shift.status === 'open'

  const toggle = async (id: string) => {
    const next = !isChecked(id)
    setLocal({ ...local, [id]: next })
    setError(null)
    try {
      await sendOrQueue({
        fn: 'set_checklist_item',
        args: { p_shift_id: shift.id, p_item_id: id, p_checked: next },
        tables: ['shift_checklist'],
        label: 'Checklist',
      })
      const allDone = list.every((i) => (i.id === id ? next : isChecked(i.id)))
      if (allDone && !shift.checklist_done_at) {
        await sendOrQueue({ fn: 'finish_checklist', args: { p_shift_id: shift.id }, tables: ['shifts'], label: 'Checklist done' })
      }
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Loading checklist</h3>
        <Badge tone={doneCount === list.length ? 'green' : 'gray'}>
          {doneCount} of {list.length}
        </Badge>
      </div>
      <ul className="mt-2">
        {list.map((item) => {
          const on = isChecked(item.id)
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={!editable}
                aria-pressed={on}
                onClick={() => void toggle(item.id)}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-slate-50 active:bg-slate-100"
              >
                {on ? <CheckSquare className="size-6 text-emerald-600" aria-hidden /> : <Square className="size-6 text-slate-400" aria-hidden />}
                <span className={on ? 'text-slate-500 line-through' : ''}>{item.name}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {error && <Notice tone="error">{error}</Notice>}
    </Card>
  )
}
