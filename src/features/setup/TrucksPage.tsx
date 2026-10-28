import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { EmptyState, TextArea } from '@/components/forms'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Button, Field, Notice, PageHeader, Select, Sheet, Spinner } from '@/components/ui'
import { deleteRow, insertRow, updateRow } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { useAction } from '@/lib/useAction'
import { BackLink } from './BackLink'
import { activeFirst, useLocations, useTrucks, useTruckTypes, type Truck } from './data'
import { EditorActions } from './EditorActions'

export function TrucksPage() {
  const trucks = useTrucks()
  const types = useTruckTypes()
  const locations = useLocations()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const current = editing === 'new' ? null : (trucks.data?.find((t) => t.id === editing) ?? null)
  const typeName = (id: string | null) => types.data?.find((t) => t.id === id)?.name ?? ''
  const homeName = (id: string | null) => locations.data?.find((l) => l.id === id)?.name ?? ''

  return (
    <div>
      <BackLink />
      <PageHeader
        title="Trucks"
        subtitle="Each truck keeps its own stock and par levels."
        action={
          <Button onClick={() => setEditing('new')} className="shrink-0">
            <Plus className="size-5" aria-hidden /> Add
          </Button>
        }
      />
      {trucks.isLoading && <Spinner />}
      {trucks.data?.length === 0 && (
        <EmptyState title="No trucks yet">Add your first truck to start tracking its stock.</EmptyState>
      )}
      {trucks.data && trucks.data.length > 0 && (
        <ResponsiveList
          rows={activeFirst(trucks.data)}
          rowKey={(t) => t.id}
          title={(t) => t.name}
          subtitle={(t) => [typeName(t.truck_type_id), homeName(t.home_location_id) && `Loads from ${homeName(t.home_location_id)}`].filter(Boolean).join(' · ')}
          badge={(t) => !t.active && <Badge>Off</Badge>}
          dimmed={(t) => !t.active}
          onSelect={(t) => setEditing(t.id)}
          columns={[
            { label: 'Name', cell: (t) => <span className="font-medium">{t.name}</span> },
            { label: 'Type', cell: (t) => typeName(t.truck_type_id) || 'Any' },
            { label: 'Loads from', cell: (t) => homeName(t.home_location_id) },
            { label: 'Status', cell: (t) => (t.active ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>) },
          ]}
        />
      )}
      <p className="mt-4 text-sm text-slate-500">
        Truck types are set up on the <Link to="/setup/lists" className="font-medium text-brand-700">Lists</Link> page.
      </p>
      {editing && <TruckSheet key={editing} truck={current} onClose={() => setEditing(null)} />}
    </div>
  )
}

function TruckSheet({ truck, onClose }: { truck: Truck | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const types = useTruckTypes()
  const locations = useLocations()
  const firstWarehouse = locations.data?.find((l) => l.active && l.kind === 'warehouse')?.id ?? locations.data?.[0]?.id ?? ''
  const [form, setForm] = useState({
    name: truck?.name ?? '',
    truck_type_id: truck?.truck_type_id ?? '',
    home_location_id: truck?.home_location_id ?? '',
    notes: truck?.notes ?? '',
  })
  const done = async () => {
    await refreshTables(queryClient, ['trucks'])
    onClose()
  }
  const save = useAction(async () => {
    const row = {
      name: form.name.trim(),
      truck_type_id: form.truck_type_id || null,
      home_location_id: form.home_location_id || firstWarehouse || null,
      notes: form.notes.trim() || null,
    }
    if (truck) await updateRow('trucks', truck.id, row)
    else await insertRow('trucks', row)
    await done()
  })
  const toggle = useAction(async () => {
    await updateRow('trucks', truck!.id, { active: !truck!.active })
    await done()
  })
  const remove = useAction(async () => {
    await deleteRow('trucks', truck!.id)
    await done()
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }
  const error = save.error ?? toggle.error ?? remove.error

  return (
    <Sheet title={truck ? truck.name : 'Add a truck'} open onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Name" required autoFocus={!truck} placeholder="Truck 1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select label="Truck type" value={form.truck_type_id} onChange={(e) => setForm({ ...form, truck_type_id: e.target.value })}>
          <option value="">Any (sees everything)</option>
          {(types.data ?? [])
            .filter((t) => t.active || t.id === form.truck_type_id)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </Select>
        <Select
          label="Loads from"
          hint="Stock loaded onto this truck comes out of this location."
          value={form.home_location_id || firstWarehouse}
          onChange={(e) => setForm({ ...form, home_location_id: e.target.value })}
        >
          {(locations.data ?? [])
            .filter((l) => l.active || l.id === form.home_location_id)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </Select>
        <TextArea label="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <EditorActions
          isNew={!truck}
          active={truck?.active ?? true}
          saving={save.busy}
          onToggleActive={() => void toggle.run()}
          onDelete={() => void remove.run()}
          deleting={remove.busy}
        />
      </form>
    </Sheet>
  )
}
