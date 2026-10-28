import { Download } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { EmptyState } from '@/components/forms'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Button, PageHeader, Select, Spinner } from '@/components/ui'
import { BackLink } from '@/features/setup/BackLink'
import { useSupplyCatalog } from '@/features/setup/data'
import { downloadCsv } from '@/lib/csv'
import { findUnit, formatAmount, formatMoney } from '@/lib/units'
import { movementLabels, useMovements, usePeopleNames, usePlaces, type Movement } from './data'

const ranges = { '1': 'Today', '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days', '365': 'Last year' }
const tone: Record<Movement['kind'], 'green' | 'blue' | 'amber' | 'red' | 'gray'> = {
  delivery: 'green',
  load: 'blue',
  return: 'blue',
  transfer: 'blue',
  usage: 'gray',
  waste: 'red',
  adjustment: 'amber',
  correction: 'amber',
}

/** Every stock move, newest first. */
export function HistoryPage() {
  const [params, setParams] = useSearchParams()
  const places = usePlaces()
  const catalog = useSupplyCatalog()
  const who = usePeopleNames()
  const [limit, setLimit] = useState(200)
  const [now] = useState(() => Date.now())
  const days = params.get('days') ?? '30'
  const since = new Date(now - Number(days) * 86400000)
  since.setHours(0, 0, 0, 0)
  const filters = {
    placeId: params.get('place') ?? '',
    supplyId: params.get('supply') ?? '',
    kind: params.get('kind') ?? '',
    since: since.toISOString(),
    limit,
  }
  const moves = useMovements(filters)
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  const c = catalog.data
  const amount = (m: Movement) => {
    const s = c?.supply(m.supply_id)
    return s ? formatAmount(Number(m.quantity), findUnit(c!.unitsOf(m.supply_id), s.count_unit_id)) : ''
  }
  const route = (m: Movement) => [m.from_place_id ? places.name(m.from_place_id) : 'Outside', m.to_place_id ? places.name(m.to_place_id) : 'Used up'].join(' → ')

  const exportCsv = () =>
    downloadCsv('stock-history.csv', [
      ['When', 'What', 'Supply', 'Amount', 'Base amount', 'From', 'To', 'Cost', 'Who', 'Reason', 'Note'],
      ...(moves.data ?? []).map((m) => [
        new Date(m.created_at).toLocaleString(),
        movementLabels[m.kind],
        c?.supply(m.supply_id)?.name ?? '',
        amount(m),
        Number(m.quantity),
        m.from_place_id ? places.name(m.from_place_id) : '',
        m.to_place_id ? places.name(m.to_place_id) : '',
        (Number(m.quantity) * Number(m.unit_cost)).toFixed(2),
        who(m.created_by),
        m.reason ?? '',
        m.note ?? '',
      ]),
    ])

  return (
    <div>
      <BackLink to="/inventory" label="Inventory" />
      <PageHeader
        title="Stock history"
        subtitle="Every delivery, load, return, waste, count, and fix, with who did it."
        action={
          <Button variant="secondary" onClick={exportCsv} disabled={!moves.data?.length} className="shrink-0">
            <Download className="size-5" aria-hidden /> CSV
          </Button>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Place" value={filters.placeId} onChange={(e) => set('place', e.target.value)}>
          <option value="">All places</option>
          {(places.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select label="Supply" value={filters.supplyId} onChange={(e) => set('supply', e.target.value)}>
          <option value="">All supplies</option>
          {(c?.supplies ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select label="Kind" value={filters.kind} onChange={(e) => set('kind', e.target.value)}>
          <option value="">Everything</option>
          {Object.entries(movementLabels).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <Select label="When" value={days} onChange={(e) => set('days', e.target.value)}>
          {Object.entries(ranges).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      {(moves.isLoading || !c) && <Spinner />}
      {moves.data?.length === 0 && <EmptyState title="Nothing moved in this time" />}
      {c && moves.data && moves.data.length > 0 && (
        <ResponsiveList
          rows={moves.data}
          rowKey={(m) => m.id}
          title={(m) => `${c.supply(m.supply_id)?.name ?? 'Supply'}: ${amount(m)}`}
          subtitle={(m) => `${route(m)} · ${who(m.created_by) || 'App'} · ${new Date(m.created_at).toLocaleString()}`}
          badge={(m) => <Badge tone={tone[m.kind]}>{movementLabels[m.kind]}</Badge>}
          columns={[
            { label: 'When', cell: (m) => new Date(m.created_at).toLocaleString(), className: 'whitespace-nowrap' },
            { label: 'What', cell: (m) => <Badge tone={tone[m.kind]}>{movementLabels[m.kind]}</Badge> },
            { label: 'Supply', cell: (m) => <span className="font-medium">{c.supply(m.supply_id)?.name}</span> },
            { label: 'Amount', cell: amount },
            { label: 'From → to', cell: route },
            { label: 'Cost', cell: (m) => formatMoney(Number(m.quantity) * Number(m.unit_cost)) },
            { label: 'Who', cell: (m) => who(m.created_by) || 'App' },
            { label: 'Why', cell: (m) => [m.reason, m.note].filter(Boolean).join(': ') },
          ]}
        />
      )}
      {moves.data && moves.data.length >= limit && (
        <Button variant="secondary" className="mt-4" onClick={() => setLimit(limit + 200)}>
          Show more
        </Button>
      )}
    </div>
  )
}
