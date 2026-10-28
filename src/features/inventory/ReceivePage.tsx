import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { TextArea } from '@/components/forms'
import { Button, Card, Notice, PageHeader, Select, Spinner } from '@/components/ui'
import { useSettings } from '@/features/settings/useSettings'
import { BackLink } from '@/features/setup/BackLink'
import { useLocations, useSuppliers, useSupplyCatalog } from '@/features/setup/data'
import { num } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { findUnit, formatMoney } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { newClientId } from './data'
import { LinesEditor } from './LinesEditor'
import { deliveryLine, newLine, type StockLine } from './stockLines'

export function ReceivePage() {
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const locations = useLocations()
  const suppliers = useSuppliers()
  const catalog = useSupplyCatalog()
  const settings = useSettings()
  const [locationId, setLocationId] = useState(params.get('location') ?? '')
  const [supplierId, setSupplierId] = useState('')
  const [lines, setLines] = useState<StockLine[]>([newLine()])
  const [note, setNote] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const activeLocations = (locations.data ?? []).filter((l) => l.active)
  const location = locationId || activeLocations.find((l) => l.kind === 'warehouse')?.id || activeLocations[0]?.id || ''
  const c = catalog.data

  const total = c
    ? lines.reduce((sum, l) => (l.supply_id && num(l.amount) && num(l.cost) ? sum + num(l.amount)! * num(l.cost)! : sum), 0)
    : 0

  const save = useAction(async () => {
    const out = lines
      .filter((l) => l.supply_id && num(l.amount))
      .map((l) => {
        const unit = findUnit(c!.unitsOf(l.supply_id), l.unit_id || null)
        const cost = num(l.cost)
        return {
          supply_id: l.supply_id,
          quantity: num(l.amount)! * unit.factor,
          unit_id: unit.id,
          unit_cost: cost === null ? null : cost / unit.factor,
          expires_on: l.expires_on || null,
        }
      })
    if (out.length === 0) throw new Error('Add at least one thing that came in.')
    await rpc('receive_delivery', { p: { location_id: location, supplier_id: supplierId || null, note, client_id: newClientId(), lines: out } })
    await refreshTables(queryClient, ['stock_levels', 'stock_movements', 'deliveries', 'supplies'])
    setDone(`Delivery saved: ${out.length} item${out.length === 1 ? '' : 's'} added to stock.`)
    setLines([newLine()])
    setNote('')
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }

  if (!c || locations.isLoading) return <Spinner />
  const fromSupplier = c.supplies.filter((s) => s.active && s.supplier_id === supplierId)

  return (
    <div>
      <BackLink to="/inventory" label="Inventory" />
      <PageHeader title="Receive a delivery" subtitle="Enter what came in. Stock and costs update right away." />
      {done && (
        <div className="mb-4">
          <Notice tone="success">
            {done}{' '}
            <Link to={`/inventory?place=${location}`} className="font-semibold underline">
              See stock
            </Link>
          </Notice>
        </div>
      )}
      <form onSubmit={submit} className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-4 lg:col-span-1">
          <Select label="Came in at" value={location} onChange={(e) => setLocationId(e.target.value)}>
            {activeLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <Select label="From supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Not listed</option>
            {(suppliers.data ?? [])
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
          {supplierId && fromSupplier.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setLines([
                  ...lines.filter((l) => l.supply_id),
                  ...fromSupplier.filter((s) => !lines.some((l) => l.supply_id === s.id)).map((s) => deliveryLine(c, s.id)),
                ])
              }
            >
              List everything from this supplier
            </Button>
          )}
          <TextArea label="Note (optional)" placeholder="Invoice number, anything missing" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
            <span className="text-slate-600">Total</span>
            <span className="text-lg font-bold">{formatMoney(total)}</span>
          </div>
          <Button type="submit" busy={save.busy} full className="hidden lg:inline-flex">
            Save delivery
          </Button>
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">What came in</h2>
          {save.error && (
            <div className="mb-3">
              <Notice tone="error">{save.error}</Notice>
            </div>
          )}
          <LinesEditor
            catalog={c}
            lines={lines}
            onChange={setLines}
            withCost
            withExpiration={settings.data?.expiration_tracking !== false}
            onSupplyPicked={(_l, id) => {
              if (!id) return {}
              const { key: _key, ...rest } = deliveryLine(c, id)
              return rest
            }}
          />
          <p className="mt-3 text-sm text-slate-500">A cost you enter here becomes the supply's current cost.</p>
          <Button type="submit" busy={save.busy} full className="mt-4 lg:hidden">
            Save delivery
          </Button>
        </Card>
      </form>
    </div>
  )
}
