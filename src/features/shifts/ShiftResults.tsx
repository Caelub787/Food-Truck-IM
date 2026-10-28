import { ResponsiveList } from '@/components/ResponsiveList'
import { Card, Spinner } from '@/components/ui'
import type { Catalog } from '@/features/setup/data'
import { findUnit, formatAmount, formatMoney, formatNumber, type Unit } from '@/lib/units'
import { useShiftResults, type ShiftResult } from './data'

/** What a finished shift used, per supply and per supply group. */
export function ShiftResults({ shiftId, catalog: c, showCost }: { shiftId: string; catalog: Catalog; showCost: boolean }) {
  const results = useShiftResults(shiftId)
  if (!results.data) return <Spinner />
  const unitOf = (r: ShiftResult): Unit => {
    if (r.supply_id) {
      const s = c.supply(r.supply_id)
      return s ? findUnit(c.unitsOf(s.id), s.count_unit_id) : { id: null, name: '', factor: 1 }
    }
    return { id: null, name: c.group(r.group_id)?.base_unit ?? '', factor: 1 }
  }
  const name = (r: ShiftResult) => (r.supply_id ? c.supply(r.supply_id)?.name : `${c.group(r.group_id)?.name ?? 'Group'} (all together)`) ?? ''
  const rows = [...results.data].sort((a, b) => Number(Boolean(a.group_id)) - Number(Boolean(b.group_id)) || name(a).localeCompare(name(b)))
  const amt = (r: ShiftResult, n: number) => formatAmount(Number(n), unitOf(r))
  // Short form for phones: just the numbers, in the same unit as the title.
  const num = (r: ShiftResult, n: number) => formatNumber(Number(n) / unitOf(r).factor)
  const supplyRows = rows.filter((r) => r.supply_id)
  const usedCost = supplyRows.reduce((sum, r) => sum + Math.max(0, Number(r.actual_qty)) * Number(r.unit_cost), 0)
  const wasteCost = supplyRows.reduce((sum, r) => sum + Number(r.waste_qty) * Number(r.unit_cost), 0)

  return (
    <div className="space-y-4">
      {showCost && (
        <div className="grid grid-cols-2 gap-3 md:max-w-md">
          <Card>
            <p className="text-sm text-slate-500">Used</p>
            <p className="text-2xl font-bold">{formatMoney(usedCost)}</p>
          </Card>
          <Card>
            <p className="text-sm text-slate-500">Wasted</p>
            <p className="text-2xl font-bold">{formatMoney(wasteCost)}</p>
          </Card>
        </div>
      )}
      <ResponsiveList
        rows={rows}
        rowKey={(r) => r.id}
        title={(r) => `${name(r)}: used ${amt(r, r.actual_qty)}`}
        subtitle={(r) => `${num(r, r.start_qty)} start + ${num(r, r.added_qty)} added − ${num(r, r.end_qty)} left − ${num(r, r.waste_qty)} waste`}
        columns={[
          { label: 'Supply', cell: (r) => <span className={r.group_id ? 'italic' : 'font-medium'}>{name(r)}</span> },
          { label: 'Started', cell: (r) => amt(r, r.start_qty), className: 'whitespace-nowrap' },
          { label: 'Added', cell: (r) => amt(r, r.added_qty), className: 'whitespace-nowrap' },
          { label: 'Left', cell: (r) => amt(r, r.end_qty), className: 'whitespace-nowrap' },
          { label: 'Waste', cell: (r) => amt(r, r.waste_qty), className: 'whitespace-nowrap' },
          { label: 'Used', cell: (r) => <span className="font-semibold">{amt(r, r.actual_qty)}</span>, className: 'whitespace-nowrap' },
          ...(showCost
            ? [{ label: 'Cost', cell: (r: ShiftResult) => (r.supply_id ? formatMoney(Number(r.actual_qty) * Number(r.unit_cost)) : '') }]
            : []),
        ]}
      />
      <p className="text-sm text-slate-500">Used = started + added − left − waste. Comparing this to sales comes with the sales update.</p>
    </div>
  )
}
