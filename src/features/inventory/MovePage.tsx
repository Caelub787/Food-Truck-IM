import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { TextArea } from '@/components/forms'
import { Button, Card, Notice, PageHeader, Select, Spinner } from '@/components/ui'
import { BackLink } from '@/features/setup/BackLink'
import { useSupplyCatalog } from '@/features/setup/data'
import { num } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { findUnit } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { newClientId, usePlaces, useStockLevels } from './data'
import { LinesEditor } from './LinesEditor'
import { newLine, type StockLine } from './stockLines'

/** Moves stock between any two places: warehouse to truck, truck back, or between locations. */
export function MovePage() {
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const places = usePlaces()
  const levels = useStockLevels()
  const catalog = useSupplyCatalog()
  const [from, setFrom] = useState(params.get('from') ?? '')
  const [to, setTo] = useState('')
  const [lines, setLines] = useState<StockLine[]>([newLine()])
  const [note, setNote] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const active = (places.data ?? []).filter((p) => p.active)
  const fromId = from || active[0]?.id || ''
  const toId = to || active.find((p) => p.id !== fromId)?.id || ''
  const qty = (supplyId: string) => Number((levels.data ?? []).find((l) => l.place_id === fromId && l.supply_id === supplyId)?.quantity ?? 0)

  const save = useAction(async () => {
    const c = catalog.data!
    const out = lines
      .filter((l) => l.supply_id && num(l.amount))
      .map((l) => ({ supply_id: l.supply_id, quantity: num(l.amount)! * findUnit(c.unitsOf(l.supply_id), l.unit_id || null).factor }))
    if (out.length === 0) throw new Error('Add at least one amount to move.')
    await rpc('transfer_stock', { p: { from_place_id: fromId, to_place_id: toId, note, client_id: newClientId(), lines: out } })
    await refreshTables(queryClient, ['stock_levels', 'stock_movements'])
    setDone(`Moved ${out.length} item${out.length === 1 ? '' : 's'} from ${places.name(fromId)} to ${places.name(toId)}.`)
    setLines([newLine()])
    setNote('')
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }

  if (!catalog.data || places.isLoading) return <Spinner />
  const option = (p: { id: string; name: string }) => (
    <option key={p.id} value={p.id}>
      {p.name}
    </option>
  )

  return (
    <div>
      <BackLink to="/inventory" label="Inventory" />
      <PageHeader title="Move stock" subtitle="Load a truck, bring stock back, or move it between locations. Both places update right away." />
      {done && (
        <div className="mb-4">
          <Notice tone="success">{done}</Notice>
        </div>
      )}
      <form onSubmit={submit} className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-4">
          <Select label="From" value={fromId} onChange={(e) => setFrom(e.target.value)}>
            <optgroup label="Locations">{active.filter((p) => p.kind === 'location').map(option)}</optgroup>
            <optgroup label="Trucks">{active.filter((p) => p.kind === 'truck').map(option)}</optgroup>
          </Select>
          <Select label="To" value={toId} onChange={(e) => setTo(e.target.value)}>
            <optgroup label="Locations">{active.filter((p) => p.kind === 'location' && p.id !== fromId).map(option)}</optgroup>
            <optgroup label="Trucks">{active.filter((p) => p.kind === 'truck' && p.id !== fromId).map(option)}</optgroup>
          </Select>
          <TextArea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" busy={save.busy} full className="hidden lg:inline-flex">
            Move stock
          </Button>
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">What's moving</h2>
          {save.error && (
            <div className="mb-3">
              <Notice tone="error">{save.error}</Notice>
            </div>
          )}
          <LinesEditor
            catalog={catalog.data}
            lines={lines}
            onChange={setLines}
            available={qty}
            onSupplyPicked={(_l, id) => {
              const s = catalog.data!.supply(id)
              return { unit_id: s?.count_unit_id ?? '' }
            }}
          />
          <Button type="submit" busy={save.busy} full className="mt-4 lg:hidden">
            Move stock
          </Button>
        </Card>
      </form>
    </div>
  )
}
