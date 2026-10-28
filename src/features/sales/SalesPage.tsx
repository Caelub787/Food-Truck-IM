import { useQueryClient } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { ConfirmButton } from '@/components/ConfirmButton'
import { EmptyState } from '@/components/forms'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Card, Notice, PageHeader, Select, Spinner } from '@/components/ui'
import { usePeopleNames } from '@/features/inventory/data'
import { useSettings } from '@/features/settings/useSettings'
import { useTrucks } from '@/features/setup/data'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { formatMoney } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { groupLabels, saleGroup, useSalesImports, useSalesSince, winningGroup, type Sale, type SaleGroup } from './data'

const ranges = { '7': 'Last 7 days', '14': 'Last 14 days', '30': 'Last 30 days', '90': 'Last 90 days' }
type DayRow = { key: string; day: string; truckId: string; drinks: number; free: number; money: number; sources: Set<SaleGroup>; noShift: boolean }

/** Sales by day and truck, file uploads (with undo), and a link to upload more. */
export function SalesPage() {
  const queryClient = useQueryClient()
  const settings = useSettings()
  const trucks = useTrucks()
  const who = usePeopleNames()
  const imports = useSalesImports()
  const [days, setDays] = useState('14')
  const [now] = useState(() => Date.now())
  const since = new Date(now - Number(days) * 86400000)
  since.setHours(0, 0, 0, 0)
  const sales = useSalesSince(since.toISOString())
  const undo = useAction(async (id: string) => {
    await rpc('undo_sales_import', { p_import_id: id })
    await refreshTables(queryClient, ['sales', 'sales_imports', 'shift_results', 'flags'])
  })
  const truckName = (id: string) => trucks.data?.find((t) => t.id === id)?.name ?? 'Truck'

  // A shift can have sales from more than one source. Count only the one that wins, like the comparison does.
  const rows = new Map<string, DayRow>()
  if (sales.data) {
    const byShift = new Map<string, Sale[]>()
    for (const s of sales.data) {
      const k = s.shift_id ?? `none:${s.truck_id}:${s.sold_at.slice(0, 10)}`
      byShift.set(k, [...(byShift.get(k) ?? []), s])
    }
    for (const [k, list] of byShift) {
      const win = winningGroup(list, settings.data)
      for (const s of list.filter((x) => saleGroup(x.source) === win)) {
        const day = new Date(s.sold_at).toLocaleDateString('en-CA')
        const key = `${day}:${s.truck_id}`
        const r = rows.get(key) ?? { key, day, truckId: s.truck_id, drinks: 0, free: 0, money: 0, sources: new Set(), noShift: false }
        r.drinks += Number(s.quantity)
        if (s.is_free) r.free += Number(s.quantity)
        r.money += Number(s.price)
        r.sources.add(saleGroup(s.source))
        if (k.startsWith('none:')) r.noShift = true
        rows.set(key, r)
      }
    }
  }
  const list = [...rows.values()].sort((a, b) => b.day.localeCompare(a.day) || truckName(a.truckId).localeCompare(truckName(b.truckId)))
  const total = list.reduce((acc, r) => ({ drinks: acc.drinks + r.drinks, free: acc.free + r.free, money: acc.money + r.money }), { drinks: 0, free: 0, money: 0 })
  const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle="Drinks sold and given away, from driver and manager counts and uploaded sales files."
        action={
          <Link
            to="/sales/upload"
            className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800"
          >
            <FileUp className="size-5" aria-hidden /> Upload
          </Link>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-4">
        <Select label="When" value={days} onChange={(e) => setDays(e.target.value)} className="col-span-3 sm:w-64 lg:col-span-1 lg:w-auto">
          {Object.entries(ranges).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Card>
          <p className="text-sm text-slate-500">Drinks</p>
          <p className="text-xl font-bold sm:text-2xl">{total.drinks.toLocaleString()}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Free</p>
          <p className="text-xl font-bold sm:text-2xl">{total.free.toLocaleString()}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Sales</p>
          <p className="text-xl font-bold sm:text-2xl">{formatMoney(total.money)}</p>
        </Card>
      </div>

      {sales.isLoading && <Spinner />}
      {sales.data && list.length === 0 && (
        <EmptyState title="No sales in this time">Drivers or managers can count drinks on a shift, or upload a sales file.</EmptyState>
      )}
      {list.length > 0 && (
        <ResponsiveList
          rows={list}
          rowKey={(r) => r.key}
          title={(r) => `${dayLabel(r.day)} · ${truckName(r.truckId)}`}
          subtitle={(r) => `${r.drinks} drinks · ${r.free} free · from ${[...r.sources].map((g) => groupLabels[g].toLowerCase()).join(', ')}`}
          badge={(r) => (r.noShift ? <Badge tone="amber">No shift</Badge> : <span className="font-semibold">{formatMoney(r.money)}</span>)}
          columns={[
            { label: 'Day', cell: (r) => dayLabel(r.day), className: 'whitespace-nowrap' },
            { label: 'Truck', cell: (r) => <span className="font-medium">{truckName(r.truckId)}</span> },
            { label: 'Drinks', cell: (r) => r.drinks },
            { label: 'Free', cell: (r) => r.free },
            { label: 'Sales', cell: (r) => formatMoney(r.money) },
            { label: 'From', cell: (r) => [...r.sources].map((g) => groupLabels[g]).join(', ') },
            { label: '', cell: (r) => (r.noShift ? <Badge tone="amber">No shift</Badge> : null) },
          ]}
        />
      )}

      <h2 className="mt-8 mb-3 text-lg font-bold">Uploaded files</h2>
      {undo.error && (
        <div className="mb-3">
          <Notice tone="error">{undo.error}</Notice>
        </div>
      )}
      {imports.data?.length === 0 && <EmptyState title="No files uploaded yet" />}
      {imports.data && imports.data.length > 0 && (
        <Card flush className="divide-y divide-slate-100">
          {imports.data.map((i) => (
            <div key={i.id} className={`flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between ${i.undone_at ? 'opacity-60' : ''}`}>
              <div className="min-w-0">
                <p className="font-medium">
                  {i.file_name ?? 'Sales file'} {i.undone_at && <Badge>Undone</Badge>}
                </p>
                <p className="text-sm text-slate-500">
                  {new Date(i.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} by{' '}
                  {who(i.created_by) || 'someone'} · {i.rows_added} added
                  {i.rows_duplicate > 0 && ` · ${i.rows_duplicate} already in`}
                  {i.rows_no_shift > 0 && ` · ${i.rows_no_shift} not on a shift`}
                  {i.rows_unmatched > 0 && ` · ${i.rows_unmatched} not matched`}
                </p>
                {i.unmatched_names.length > 0 && !i.undone_at && (
                  <p className="text-sm text-amber-700">Not matched: {i.unmatched_names.slice(0, 8).join(', ')}</p>
                )}
              </div>
              {!i.undone_at && (
                <ConfirmButton variant="secondary" confirmLabel="Tap again to undo" busy={undo.busy} onConfirm={() => void undo.run(i.id)} className="shrink-0">
                  Undo upload
                </ConfirmButton>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
