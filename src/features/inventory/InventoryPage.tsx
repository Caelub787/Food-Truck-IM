import { ArrowRightLeft, ClipboardCheck, ClipboardList, History, PackagePlus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EmptyState, SearchBox } from '@/components/forms'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Card, PageHeader, Select, Spinner } from '@/components/ui'
import { useSettings } from '@/features/settings/useSettings'
import { useSupplyCatalog, type Supply } from '@/features/setup/data'
import { matchesSearch } from '@/lib/search'
import { findUnit, formatAmount, formatMoney } from '@/lib/units'
import { daysUntil, useBatches, usePlaces, useStockLevels } from './data'
import { SupplyStockSheet } from './SupplyStockSheet'

export function InventoryPage() {
  const [params, setParams] = useSearchParams()
  const places = usePlaces()
  const levels = useStockLevels()
  const batches = useBatches()
  const catalog = useSupplyCatalog()
  const settings = useSettings()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const active = (places.data ?? []).filter((p) => p.active)
  const placeId = params.get('place') ?? active.find((p) => p.kind === 'location')?.id ?? active[0]?.id ?? ''
  const place = places.data?.find((p) => p.id === placeId)
  const atPlace = (levels.data ?? []).filter((l) => l.place_id === placeId)
  const qty = (supplyId: string) => Number(atPlace.find((l) => l.supply_id === supplyId)?.quantity ?? 0)
  const warnDays = settings.data?.expiration_warning_days ?? 3
  const expiringSoon = (supplyId: string) =>
    (batches.data ?? []).some((b) => b.place_id === placeId && b.supply_id === supplyId && b.expires_on && daysUntil(b.expires_on) <= warnDays && Number(b.quantity) > 0)

  if (places.isLoading || catalog.isLoading || levels.isLoading) return <Spinner />
  const c = catalog.data!

  // At a location show every supply. On a truck show what it carries.
  const supplies = c.supplies.filter(
    (s) =>
      (place?.kind === 'location' ? s.active : qty(s.id) !== 0) &&
      matchesSearch(search, s.name, s.category),
  )
  const status = (s: Supply) => {
    const q = qty(s.id)
    if (q < 0) return <Badge tone="red">Below zero</Badge>
    if (place?.kind === 'location' && s.reorder_level !== null && q <= Number(s.reorder_level)) return q <= 0 ? <Badge tone="red">Out</Badge> : <Badge tone="amber">Low</Badge>
    if (expiringSoon(s.id)) return <Badge tone="amber">Expiring soon</Badge>
    return <Badge tone="green">OK</Badge>
  }
  const amount = (s: Supply) => formatAmount(qty(s.id), findUnit(c.unitsOf(s.id), s.count_unit_id))
  const value = (s: Supply) => formatMoney(Math.max(0, qty(s.id)) * Number(s.cost_per_base))
  const total = supplies.reduce((sum, s) => sum + Math.max(0, qty(s.id)) * Number(s.cost_per_base), 0)
  const lowCount = supplies.filter((s) => place?.kind === 'location' && s.reorder_level !== null && qty(s.id) <= Number(s.reorder_level)).length

  const actions = [
    { to: `/inventory/receive?location=${place?.kind === 'location' ? placeId : ''}`, label: 'Receive delivery', icon: PackagePlus },
    { to: `/inventory/count?place=${placeId}`, label: 'Count', icon: ClipboardCheck },
    { to: `/inventory/move?from=${placeId}`, label: 'Move stock', icon: ArrowRightLeft },
    { to: `/inventory/waste?place=${placeId}`, label: 'Waste', icon: Trash2 },
    { to: '/orders', label: 'Orders', icon: ClipboardList },
    { to: `/inventory/history?place=${placeId}`, label: 'History', icon: History },
  ]

  return (
    <div>
      <PageHeader title="Inventory" subtitle="What's in each warehouse and truck right now. Updates live as people work." />
      {active.length === 0 ? (
        <EmptyState title="No locations or trucks yet">
          <Link to="/setup" className="font-medium text-brand-700">
            Set them up first
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end">
            <Select label="Showing" value={placeId} onChange={(e) => setParams({ place: e.target.value })} className="md:w-72">
              <optgroup label="Locations">
                {active
                  .filter((p) => p.kind === 'location')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Trucks">
                {active
                  .filter((p) => p.kind === 'truck')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            </Select>
            <SearchBox value={search} onChange={setSearch} placeholder="Find a supply" />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {actions.map((a) => (
              <Link
                key={a.label}
                to={a.to}
                className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 font-semibold text-slate-800 shadow-sm hover:border-brand-600 active:bg-slate-50"
              >
                <a.icon className="size-5 text-brand-700" aria-hidden /> {a.label}
              </Link>
            ))}
          </div>

          <Card className="mb-4 flex flex-wrap gap-x-8 gap-y-2">
            <div>
              <p className="text-sm text-slate-500">Value on hand</p>
              <p className="text-xl font-bold">{formatMoney(total)}</p>
            </div>
            {place?.kind === 'location' && (
              <div>
                <p className="text-sm text-slate-500">Low or out</p>
                <p className={`text-xl font-bold ${lowCount ? 'text-amber-600' : ''}`}>{lowCount}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-slate-500">Supplies here</p>
              <p className="text-xl font-bold">{supplies.filter((s) => qty(s.id) > 0).length}</p>
            </div>
          </Card>

          {supplies.length === 0 ? (
            <EmptyState title={place?.kind === 'truck' ? 'Nothing on this truck right now' : 'No supplies match'}>
              {place?.kind === 'truck' ? 'Stock shows up here once the truck is loaded.' : null}
            </EmptyState>
          ) : (
            <ResponsiveList
              rows={supplies}
              rowKey={(s) => s.id}
              title={(s) => s.name}
              subtitle={(s) => amount(s)}
              badge={status}
              onSelect={(s) => setOpen(s.id)}
              actionLabel="Details"
              columns={[
                { label: 'Supply', cell: (s) => <span className="font-medium">{s.name}</span> },
                { label: 'Category', cell: (s) => s.category ?? '' },
                { label: 'On hand', cell: amount },
                {
                  label: 'Reorder at',
                  cell: (s) => (s.reorder_level !== null && place?.kind === 'location' ? formatAmount(Number(s.reorder_level), findUnit(c.unitsOf(s.id), s.count_unit_id)) : ''),
                },
                { label: 'Value', cell: value },
                { label: 'Status', cell: status },
              ]}
            />
          )}
        </>
      )}
      {open && <SupplyStockSheet supplyId={open} placeId={placeId} onClose={() => setOpen(null)} />}
    </div>
  )
}
