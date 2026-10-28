import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Button, Notice } from '@/components/ui'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { findUnit, formatAmount, formatNumber } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import type { ShiftCtx } from './context'
import { sortSupplies } from './data'
import { ActionBar, SupplyCards } from './SupplyCards'

/**
 * A manager recounts certain supplies (like cups) after the shift. Blind by
 * default: the driver's numbers show only after the manager's count is in.
 */
export function CountCheckStep({ ctx }: { ctx: ShiftCtx }) {
  const { shift, catalog: c } = ctx
  const queryClient = useQueryClient()
  const status = shift.count_check_status
  const checked = sortSupplies(c, ctx.supplyIds).filter((s) => s.count_check)
  const saved = (id: string) => ctx.counts.find((x) => x.supply_id === id && x.kind === 'check')
  const driver = (id: string) => ctx.counts.find((x) => x.supply_id === id && x.kind === 'end')
  const [values, setValues] = useState<Record<string, number | null>>({})
  const [editing, setEditing] = useState(false)
  const value = (id: string) => (id in values ? values[id]! : saved(id) ? Number(saved(id)!.quantity) : null)
  const blind = ctx.settings?.count_check_blind ?? true

  const save = useAction(async () => {
    const lines = checked.map((s) => ({ supply_id: s.id, quantity: value(s.id) }))
    if (lines.some((l) => l.quantity === null)) throw new Error('Count every supply on the list first.')
    await rpc('record_count_check', { p: { shift_id: shift.id, lines } })
    await refreshTables(queryClient, ['shifts', 'shift_counts', 'shift_results', 'stock_levels', 'stock_movements', 'flags'])
    setValues({})
    setEditing(false)
  })

  if (status === 'missed') return <Notice tone="warning">The truck went out again before anyone counted it, so this check was missed.</Notice>
  if (status === 'not_needed' || checked.length === 0) return <Notice>This shift doesn't need a count check.</Notice>

  if (status === 'done' && !editing) {
    return (
      <div className="space-y-4">
        <Notice tone="success">Count check done. {ctx.settings?.count_check_manager_wins ? "The manager's count is used for this shift." : ''}</Notice>
        <ResponsiveList
          rows={checked}
          rowKey={(s) => s.id}
          title={(s) => s.name}
          subtitle={(s) => {
            const unit = findUnit(c.unitsOf(s.id), s.count_unit_id)
            const n = (q: number) => formatNumber(q / unit.factor)
            return `Driver ${driver(s.id) ? n(Number(driver(s.id)!.quantity)) : 'none'}, manager ${n(Number(saved(s.id)?.quantity ?? 0))} (${unit.name}s)`
          }}
          badge={(s) =>
            Number(driver(s.id)?.quantity ?? -1) === Number(saved(s.id)?.quantity ?? -2) ? <Badge tone="green">Matches</Badge> : <Badge tone="amber">Different</Badge>
          }
          columns={[
            { label: 'Supply', cell: (s) => <span className="font-medium">{s.name}</span> },
            { label: 'Driver counted', cell: (s) => (driver(s.id) ? formatAmount(Number(driver(s.id)!.quantity), findUnit(c.unitsOf(s.id), s.count_unit_id)) : 'None') },
            { label: 'Manager counted', cell: (s) => formatAmount(Number(saved(s.id)?.quantity ?? 0), findUnit(c.unitsOf(s.id), s.count_unit_id)) },
            {
              label: '',
              cell: (s) =>
                Number(driver(s.id)?.quantity ?? -1) === Number(saved(s.id)?.quantity ?? -2) ? <Badge tone="green">Matches</Badge> : <Badge tone="amber">Different</Badge>,
            },
          ]}
        />
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Fix the count
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Notice>
        Count these on the truck now, before it goes out again.{' '}
        {blind && status === 'waiting' ? "You'll see the driver's numbers after you save yours." : ''}
      </Notice>
      <SupplyCards
        catalog={c}
        supplies={checked}
        value={value}
        onChange={(id, base) => setValues({ ...values, [id]: base })}
        info={(s) =>
          !blind || status === 'done'
            ? `Driver counted ${driver(s.id) ? formatAmount(Number(driver(s.id)!.quantity), findUnit(c.unitsOf(s.id), s.count_unit_id)) : 'nothing'}`
            : null
        }
      />
      <ActionBar>
        <span className="text-slate-600">{checked.filter((s) => value(s.id) !== null).length} of {checked.length} counted</span>
        {save.error && <Notice tone="error">{save.error}</Notice>}
        <Button busy={save.busy} onClick={() => void save.run()}>
          Save count check
        </Button>
      </ActionBar>
    </div>
  )
}
