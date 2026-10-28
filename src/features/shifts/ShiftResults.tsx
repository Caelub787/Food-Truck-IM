import { useState } from 'react'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Card, Notice, Spinner } from '@/components/ui'
import { groupLabels, type SaleGroup } from '@/features/sales/data'
import type { Catalog } from '@/features/setup/data'
import { findUnit, formatAmount, formatMoney, formatNumber, type Unit } from '@/lib/units'
import { CorrectionSheet } from './CorrectionSheet'
import { useShiftResults, type ShiftResult } from './data'
import { usePeopleNames } from '@/features/inventory/data'
import { useLiveQuery } from '@/lib/live'
import { supabase } from '@/lib/supabase'

/** What a finished shift used, per supply and per supply group. */
export function ShiftResults({
  shiftId,
  catalog: c,
  showCost,
  compared,
  canFix,
}: {
  shiftId: string
  catalog: Catalog
  showCost: boolean
  /** The sales source used for expected usage, or null when there were no sales. */
  compared: SaleGroup | null
  /** Managers can fix counts on finished shifts. */
  canFix?: boolean
}) {
  const results = useShiftResults(shiftId)
  const [fixing, setFixing] = useState<string | null>(null)
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
  const hasExpected = rows.some((r) => r.expected_qty !== null)
  const flagged = rows.filter((r) => r.flagged)
  const diff = (r: ShiftResult) => {
    if (r.diff_qty === null) return ''
    const d = Number(r.diff_qty)
    return `${d > 0 ? '+' : ''}${amt(r, d)}`
  }

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
      {compared && (
        <Notice tone={flagged.length > 0 ? 'warning' : 'success'}>
          Compared with the {groupLabels[compared].toLowerCase()}.{' '}
          {flagged.length > 0 ? `${flagged.length} thing${flagged.length === 1 ? ' is' : 's are'} off by more than your limits.` : 'Everything is within your limits.'}
        </Notice>
      )}
      <ResponsiveList
        rows={rows}
        rowKey={(r) => r.id}
        title={(r) => `${name(r)}: used ${amt(r, r.actual_qty)}`}
        subtitle={(r) =>
          r.expected_qty !== null
            ? `Sales say ${amt(r, r.expected_qty)} · ${diff(r)}`
            : `${num(r, r.start_qty)} start + ${num(r, r.added_qty)} added − ${num(r, r.end_qty)} left − ${num(r, r.waste_qty)} waste`
        }
        badge={(r) => (r.flagged ? <Badge tone="amber">Check</Badge> : null)}
        columns={[
          { label: 'Supply', cell: (r) => <span className={r.group_id ? 'italic' : 'font-medium'}>{name(r)}</span>, className: 'min-w-44' },
          ...(hasExpected
            ? [
                // Less room when comparing, so the counts share one column.
                {
                  label: 'Start + added − left − waste',
                  cell: (r: ShiftResult) => `${num(r, r.start_qty)} + ${num(r, r.added_qty)} − ${num(r, r.end_qty)} − ${num(r, r.waste_qty)}`,
                  className: 'whitespace-nowrap text-slate-600',
                },
              ]
            : [
                { label: 'Started', cell: (r: ShiftResult) => amt(r, r.start_qty), className: 'whitespace-nowrap' },
                { label: 'Added', cell: (r: ShiftResult) => amt(r, r.added_qty), className: 'whitespace-nowrap' },
                { label: 'Left', cell: (r: ShiftResult) => amt(r, r.end_qty), className: 'whitespace-nowrap' },
                { label: 'Waste', cell: (r: ShiftResult) => amt(r, r.waste_qty), className: 'whitespace-nowrap' },
              ]),
          { label: 'Used', cell: (r) => <span className="font-semibold">{amt(r, r.actual_qty)}</span>, className: 'whitespace-nowrap' },
          ...(hasExpected
            ? [
                { label: 'Sales say', cell: (r: ShiftResult) => (r.expected_qty === null ? '' : amt(r, r.expected_qty)), className: 'whitespace-nowrap' },
                {
                  label: 'Difference',
                  cell: (r: ShiftResult) =>
                    r.flagged ? <Badge tone="amber">{diff(r)}</Badge> : <span className="text-slate-600">{diff(r)}</span>,
                  className: 'whitespace-nowrap',
                },
              ]
            : []),
          ...(showCost
            ? [{ label: 'Cost', cell: (r: ShiftResult) => (r.supply_id ? formatMoney(Number(r.actual_qty) * Number(r.unit_cost)) : '') }]
            : []),
        ]}
        onSelect={canFix ? (r) => r.supply_id && setFixing(r.id) : undefined}
        actionLabel="Fix"
      />
      {fixing && results.data.find((r) => r.id === fixing) && (
        <CorrectionSheet shiftId={shiftId} result={results.data.find((r) => r.id === fixing)!} catalog={c} onClose={() => setFixing(null)} />
      )}
      <Corrections shiftId={shiftId} catalog={c} />
      <p className="text-sm text-slate-500">
        Used = started + added − left − waste.{' '}
        {compared ? 'Sales say = what the drinks sold (paid and free) should have used, from your recipes.' : 'No sales on this shift, so there is nothing to compare with.'}
      </p>
    </div>
  )
}

type Correction = { id: number; actor_id: string | null; old_data: { supply_id: string; kind: string; quantity: number | null }; new_data: { quantity: number }; reason: string | null; created_at: string }

/** Fixes made to this shift's counts after it finished, with who and why. */
function Corrections({ shiftId, catalog: c }: { shiftId: string; catalog: Catalog }) {
  const who = usePeopleNames()
  const list = useLiveQuery({
    tables: ['audit_log', 'shift_counts'],
    queryKey: ['corrections', shiftId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_log')
        .select('id, actor_id, old_data, new_data, reason, created_at')
        .eq('table_name', 'shift_counts')
        .eq('action', 'correct')
        .eq('row_id', shiftId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Correction[]
    },
  })
  if (!list.data || list.data.length === 0) return null
  return (
    <Card>
      <h3 className="font-semibold">Fixes after the shift</h3>
      <ul className="mt-2 divide-y divide-slate-100">
        {list.data.map((x) => {
          const s = c.supply(x.old_data.supply_id)
          const unit = s ? findUnit(c.unitsOf(s.id), s.count_unit_id) : { id: null, name: '', factor: 1 }
          return (
            <li key={x.id} className="py-2">
              <p>
                <strong>{who(x.actor_id) || 'Someone'}</strong> changed the {x.old_data.kind === 'end' ? 'ending' : 'starting'} count of {s?.name ?? 'a supply'} from{' '}
                {x.old_data.quantity === null ? 'nothing' : formatAmount(Number(x.old_data.quantity), unit)} to {formatAmount(Number(x.new_data.quantity), unit)}.
              </p>
              <p className="text-sm text-slate-500">
                {x.reason} · {new Date(x.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
