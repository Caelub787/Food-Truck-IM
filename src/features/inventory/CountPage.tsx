import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { CountInput } from '@/components/CountInput'
import { SearchBox, Toggle } from '@/components/forms'
import { Button, Card, Notice, PageHeader, Select, Spinner } from '@/components/ui'
import { BackLink } from '@/features/setup/BackLink'
import { useSupplyCatalog, useTrucks } from '@/features/setup/data'
import { refreshTables } from '@/lib/live'
import { matchesSearch } from '@/lib/search'
import { rpc } from '@/lib/supabase'
import { findUnit, formatAmount } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { newClientId, usePlaces, useStockLevels } from './data'

/** A full count of a warehouse or truck. Whatever is counted becomes the new stock. */
export function CountPage() {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const places = usePlaces()
  const levels = useStockLevels()
  const catalog = useSupplyCatalog()
  const trucks = useTrucks()
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [showExpected, setShowExpected] = useState(true)
  const [search, setSearch] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const active = (places.data ?? []).filter((p) => p.active)
  const placeId = params.get('place') || active[0]?.id || ''
  const place = places.data?.find((p) => p.id === placeId)
  const truck = trucks.data?.find((t) => t.id === placeId)
  const qty = (supplyId: string) => Number((levels.data ?? []).find((l) => l.place_id === placeId && l.supply_id === supplyId)?.quantity ?? 0)

  const save = useAction(async () => {
    const c = catalog.data!
    const lines = Object.entries(counts)
      .filter(([, v]) => v !== null)
      .map(([supplyId, v]) => {
        const s = c.supply(supplyId)!
        return { supply_id: supplyId, counted: v! * findUnit(c.unitsOf(supplyId), s.count_unit_id).factor }
      })
    if (lines.length === 0) throw new Error('Count at least one thing first.')
    await rpc('record_count', { p: { place_id: placeId, client_id: newClientId(), lines } })
    await refreshTables(queryClient, ['stock_levels', 'stock_movements', 'stock_counts'])
    setDone(`Count saved for ${lines.length} supplies. Stock now matches what you counted.`)
    setCounts({})
  })

  if (!catalog.data || places.isLoading || levels.isLoading) return <Spinner />
  const c = catalog.data
  const supplies = c.supplies
    .filter((s) => s.active || qty(s.id) !== 0)
    .filter((s) => place?.kind !== 'truck' || qty(s.id) !== 0 || !s.truck_type_id || s.truck_type_id === truck?.truck_type_id)
    .filter((s) => matchesSearch(search, s.name, s.category))
    .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name))
  const counted = Object.values(counts).filter((v) => v !== null).length

  return (
    <div>
      <BackLink to={`/inventory?place=${placeId}`} label="Inventory" />
      <PageHeader title="Count stock" subtitle="Count what's really there. Anything you count replaces what the app had, and the difference is logged." />
      {done && (
        <div className="mb-4">
          <Notice tone="success">
            {done}{' '}
            <Link to={`/inventory/history?place=${placeId}&kind=adjustment`} className="font-semibold underline">
              See the differences
            </Link>
          </Notice>
        </div>
      )}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end">
        <Select
          label="Counting at"
          value={placeId}
          onChange={(e) => {
            setCounts({})
            setParams({ place: e.target.value })
          }}
          className="md:w-72"
        >
          {active.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <SearchBox value={search} onChange={setSearch} placeholder="Find a supply" />
      </div>
      <div className="mb-4">
        <Toggle label="Show what the app expects" hint="Turn off for a blind count." checked={showExpected} onChange={setShowExpected} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {supplies.map((s) => {
          const unit = findUnit(c.unitsOf(s.id), s.count_unit_id)
          const value = counts[s.id] ?? null
          const expected = qty(s.id)
          const diff = value === null ? null : value * unit.factor - expected
          return (
            <Card key={s.id} className={value !== null ? 'ring-2 ring-brand-100' : ''}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{s.name}</p>
                  {showExpected && <p className="text-sm text-slate-500">App has {formatAmount(expected, unit)}</p>}
                </div>
                {diff !== null && Math.abs(diff) > 0.0001 && showExpected && (
                  <span className={`text-sm font-semibold ${diff < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {diff > 0 ? '+' : ''}
                    {formatAmount(diff, unit)}
                  </span>
                )}
              </div>
              <CountInput label={`${s.name} count`} unit={unit.name} wholeOnly={s.whole_only} value={value} onChange={(v) => setCounts({ ...counts, [s.id]: v })} />
            </Card>
          )
        })}
      </div>

      <div className="sticky bottom-20 z-20 mt-6 md:bottom-4">
        <Card className="flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <span className="text-slate-600">
            {counted} of {supplies.length} counted
          </span>
          {save.error && <Notice tone="error">{save.error}</Notice>}
          <Button busy={save.busy} disabled={counted === 0} onClick={() => void save.run()}>
            Save count
          </Button>
        </Card>
      </div>
    </div>
  )
}
