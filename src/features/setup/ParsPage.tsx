import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { CountInput } from '@/components/CountInput'
import { EmptyState, SearchBox } from '@/components/forms'
import { Button, Card, Notice, PageHeader, Select, Spinner } from '@/components/ui'
import { useTruckPars } from '@/features/shifts/data'
import { ActionBar } from '@/features/shifts/SupplyCards'
import { refreshTables } from '@/lib/live'
import { matchesSearch } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import { findUnit } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { BackLink } from './BackLink'
import { useSupplyCatalog, useTrucks } from './data'

/**
 * Par levels: how much of each supply a truck should leave with. Loading lists
 * fill in whatever it takes to get back up to these.
 */
export function ParsPage() {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const trucks = useTrucks()
  const pars = useTruckPars()
  const catalog = useSupplyCatalog()
  const [edits, setEdits] = useState<Record<string, number | null>>({})
  const [search, setSearch] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const active = (trucks.data ?? []).filter((t) => t.active)
  const truckId = params.get('truck') || active[0]?.id || ''
  const truck = trucks.data?.find((t) => t.id === truckId)
  const saved = (supplyId: string, forTruck = truckId) =>
    Number(pars.data?.find((p) => p.truck_id === forTruck && p.supply_id === supplyId)?.par_quantity ?? 0) || null
  const value = (supplyId: string) => (supplyId in edits ? edits[supplyId]! : saved(supplyId))
  const changed = Object.keys(edits).filter((id) => (edits[id] ?? null) !== saved(id))

  const save = useAction(async () => {
    const upserts = changed.filter((id) => (edits[id] ?? 0) > 0).map((id) => ({ truck_id: truckId, supply_id: id, par_quantity: edits[id] }))
    const removed = changed.filter((id) => !edits[id])
    if (upserts.length > 0) {
      const { error } = await supabase.from('truck_pars').upsert(upserts, { onConflict: 'truck_id,supply_id' })
      if (error) throw error
    }
    if (removed.length > 0) {
      const { error } = await supabase.from('truck_pars').delete().eq('truck_id', truckId).in('supply_id', removed)
      if (error) throw error
    }
    await refreshTables(queryClient, ['truck_pars'])
    setEdits({})
    setDone(`Saved ${changed.length} par level${changed.length === 1 ? '' : 's'} for ${truck?.name ?? 'the truck'}.`)
  })

  if (!catalog.data || trucks.isLoading || pars.isLoading) return <Spinner />
  const c = catalog.data
  const supplies = c.supplies
    .filter((s) => (s.active && (!s.truck_type_id || s.truck_type_id === truck?.truck_type_id)) || saved(s.id))
    .filter((s) => matchesSearch(search, s.name, s.category))
    .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name))
  const others = active.filter((t) => t.id !== truckId && pars.data?.some((p) => p.truck_id === t.id))

  return (
    <div>
      <BackLink to="/setup" label="Setup" />
      <PageHeader
        title="Par levels"
        subtitle="How much each truck should leave with. When a driver loads up, the app fills in what it takes to get back to these. Leave blank for things you don't keep on the truck."
      />
      {active.length === 0 ? (
        <EmptyState title="No trucks yet">Add a truck in Setup first.</EmptyState>
      ) : (
        <>
          {done && (
            <div className="mb-4">
              <Notice tone="success">{done}</Notice>
            </div>
          )}
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end">
            <Select
              label="Truck"
              value={truckId}
              onChange={(e) => {
                setEdits({})
                setDone(null)
                setParams({ truck: e.target.value })
              }}
              className="md:w-64"
            >
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            {others.length > 0 && (
              <Select
                label="Copy from another truck"
                value=""
                onChange={(e) => {
                  const from = e.target.value
                  if (!from) return
                  const next: Record<string, number | null> = {}
                  for (const s of c.supplies) next[s.id] = saved(s.id, from)
                  setEdits(next)
                }}
                className="md:w-64"
              >
                <option value="">Pick a truck</option>
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
            <SearchBox value={search} onChange={setSearch} placeholder="Find a supply" />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {supplies.map((s) => {
              const unit = findUnit(c.unitsOf(s.id), s.count_unit_id)
              const v = value(s.id)
              return (
                <Card key={s.id} className={changed.includes(s.id) ? 'ring-2 ring-brand-100' : ''}>
                  <p className="mb-2 font-semibold">
                    {s.name}
                    {s.category && <span className="ml-2 text-sm font-normal text-slate-500">{s.category}</span>}
                  </p>
                  <CountInput
                    label={`${s.name} par level`}
                    unit={unit.name}
                    wholeOnly={s.whole_only}
                    value={v === null ? null : v / unit.factor}
                    onChange={(n) => setEdits({ ...edits, [s.id]: n === null || n === 0 ? null : n * unit.factor })}
                  />
                </Card>
              )
            })}
          </div>
          <ActionBar>
            <span className="text-slate-600">{changed.length === 0 ? 'No changes' : `${changed.length} changed`}</span>
            {save.error && <Notice tone="error">{save.error}</Notice>}
            <Button busy={save.busy} disabled={changed.length === 0} onClick={() => void save.run()}>
              Save par levels
            </Button>
          </ActionBar>
        </>
      )}
    </div>
  )
}
