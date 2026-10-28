import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { EmptyState } from '@/components/forms'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Button, Field, Notice, PageHeader, Select, Sheet, Spinner } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { deleteRow, insertRow, updateRow } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { useAction } from '@/lib/useAction'
import { BackLink } from './BackLink'
import { activeFirst, useLocations, type Location } from './data'
import { EditorActions } from './EditorActions'

const kinds = { warehouse: 'Warehouse', storage: 'Storage unit', commissary: 'Commissary', other: 'Other' }

export function LocationsPage() {
  const me = useMeLoaded()
  const canEdit = me.profile?.role === 'admin'
  const locations = useLocations()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const current = editing === 'new' ? null : (locations.data?.find((l) => l.id === editing) ?? null)

  return (
    <div>
      <BackLink />
      <PageHeader
        title="Locations"
        subtitle="Places that hold stock, like your warehouse or a storage unit. Trucks load from their home location."
        action={
          canEdit && (
            <Button onClick={() => setEditing('new')} className="shrink-0">
              <Plus className="size-5" aria-hidden /> Add
            </Button>
          )
        }
      />
      {!canEdit && <Notice tone="info">Only admins can change locations.</Notice>}
      {locations.isLoading && <Spinner />}
      {locations.data?.length === 0 && <EmptyState title="No locations yet" />}
      {locations.data && locations.data.length > 0 && (
        <ResponsiveList
          rows={activeFirst(locations.data)}
          rowKey={(l) => l.id}
          title={(l) => l.name}
          subtitle={(l) => [kinds[l.kind], l.address].filter(Boolean).join(' · ')}
          badge={(l) => !l.active && <Badge>Off</Badge>}
          dimmed={(l) => !l.active}
          onSelect={canEdit ? (l) => setEditing(l.id) : undefined}
          columns={[
            { label: 'Name', cell: (l) => <span className="font-medium">{l.name}</span> },
            { label: 'Kind', cell: (l) => kinds[l.kind] },
            { label: 'Address', cell: (l) => l.address ?? '' },
            { label: 'Status', cell: (l) => (l.active ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>) },
          ]}
        />
      )}
      {editing && <LocationSheet key={editing} location={current} onClose={() => setEditing(null)} />}
    </div>
  )
}

function LocationSheet({ location, onClose }: { location: Location | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: location?.name ?? '',
    kind: location?.kind ?? 'warehouse',
    address: location?.address ?? '',
  })
  const done = async () => {
    await refreshTables(queryClient, ['locations'])
    onClose()
  }
  const save = useAction(async () => {
    const row = { name: form.name.trim(), kind: form.kind, address: form.address.trim() || null }
    if (location) await updateRow('locations', location.id, row)
    else await insertRow('locations', row)
    await done()
  })
  const toggle = useAction(async () => {
    await updateRow('locations', location!.id, { active: !location!.active })
    await done()
  })
  const remove = useAction(async () => {
    await deleteRow('locations', location!.id)
    await done()
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }
  const error = save.error ?? toggle.error ?? remove.error

  return (
    <Sheet title={location ? location.name : 'Add a location'} open onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Name" required autoFocus={!location} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Location['kind'] })}>
          {Object.entries(kinds).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Field label="Address (optional)" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <EditorActions
          isNew={!location}
          active={location?.active ?? true}
          saving={save.busy}
          onToggleActive={() => void toggle.run()}
          onDelete={() => void remove.run()}
          deleting={remove.busy}
        />
      </form>
    </Sheet>
  )
}
