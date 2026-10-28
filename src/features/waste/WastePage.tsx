import { Download, Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { EmptyState } from '@/components/forms'
import { Button, Card, Notice, PageHeader, Select, Spinner } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { usePeopleNames, usePlaces } from '@/features/inventory/data'
import { useWasteLogs } from '@/features/shifts/data'
import { BackLink } from '@/features/setup/BackLink'
import { useRows } from '@/lib/data'
import { downloadCsv } from '@/lib/csv'
import { formatMoney } from '@/lib/units'
import type { Named } from '@/features/setup/data'
import { useWasteLabel } from './useWasteLabel'
import { WasteList } from './WasteList'
import { WasteSheet } from './WasteSheet'

const ranges = { '1': 'Today', '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days' }

/** Every bit of waste, on trucks and in the warehouse, with its cost. */
export function WastePage() {
  const me = useMeLoaded()
  const [params, setParams] = useSearchParams()
  const places = usePlaces()
  const label = useWasteLabel()
  const who = usePeopleNames()
  const reasons = useRows<Named>('waste_reasons', { order: 'sort,name' })
  const [now] = useState(() => Date.now())
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const days = params.get('days') ?? '7'
  const placeId = params.get('place') ?? ''
  const since = new Date(now - Number(days) * 86400000)
  since.setHours(0, 0, 0, 0)
  const waste = useWasteLogs({ since: since.toISOString(), placeId: placeId || undefined, limit: 500 })
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }
  const rows = waste.data ?? []
  const total = rows.reduce((sum, w) => sum + Number(w.cost), 0)
  const byReason = new Map<string, number>()
  for (const w of rows) {
    const r = reasons.data?.find((x) => x.id === w.reason_id)?.name ?? 'No reason'
    byReason.set(r, (byReason.get(r) ?? 0) + Number(w.cost))
  }
  const activePlaces = (places.data ?? []).filter((p) => p.active)

  const exportCsv = () =>
    downloadCsv('waste.csv', [
      ['When', 'What', 'Where', 'Why', 'Note', 'Who', 'Cost'],
      ...rows.map((w) => [
        new Date(w.created_at).toLocaleString(),
        label(w),
        places.name(w.place_id),
        reasons.data?.find((x) => x.id === w.reason_id)?.name ?? '',
        w.note ?? '',
        who(w.created_by),
        Number(w.cost).toFixed(2),
      ]),
    ])

  return (
    <div>
      <BackLink to="/inventory" label="Inventory" />
      <PageHeader
        title="Waste"
        subtitle="Spills, drops, and anything thrown out, on trucks and in the warehouse."
        action={
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="size-5" aria-hidden /> <span className="hidden sm:inline">CSV</span>
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-5" aria-hidden /> Log
            </Button>
          </div>
        }
      />
      {done && (
        <div className="mb-4">
          <Notice tone="success">{done}</Notice>
        </div>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Select label="Where" value={placeId} onChange={(e) => set('place', e.target.value)}>
          <option value="">Everywhere</option>
          {(places.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select label="When" value={days} onChange={(e) => set('days', e.target.value)}>
          {Object.entries(ranges).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      {rows.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <p className="text-sm text-slate-500">Waste cost</p>
            <p className="text-2xl font-bold">{formatMoney(total)}</p>
          </Card>
          {[...byReason.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([r, cost]) => (
              <Card key={r}>
                <p className="text-sm text-slate-500">{r}</p>
                <p className="text-2xl font-bold">{formatMoney(cost)}</p>
              </Card>
            ))}
        </div>
      )}
      {waste.isLoading && <Spinner />}
      {waste.data && rows.length === 0 && <EmptyState title="No waste in this time">Nice work.</EmptyState>}
      {rows.length > 0 && <WasteList rows={rows} showCost placeName={places.name} />}
      {me.company && (
        <WasteSheet open={open} onClose={() => setOpen(false)} onSaved={setDone} companyId={me.company.id} places={activePlaces} />
      )}
    </div>
  )
}
