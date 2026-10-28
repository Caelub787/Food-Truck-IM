import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { EmptyState, TextArea } from '@/components/forms'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Button, Field, Notice, PageHeader, Select, Sheet, Spinner } from '@/components/ui'
import { deleteRow, insertRow, num, updateRow } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { formatMoney } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { BackLink } from './BackLink'
import { activeFirst, useSuppliers, type Supplier } from './data'
import { EditorActions } from './EditorActions'

export function SuppliersPage() {
  const suppliers = useSuppliers()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const current = editing === 'new' ? null : (suppliers.data?.find((s) => s.id === editing) ?? null)

  return (
    <div>
      <BackLink />
      <PageHeader
        title="Suppliers"
        subtitle="Who you buy from. Order lists are grouped by supplier."
        action={
          <Button onClick={() => setEditing('new')} className="shrink-0">
            <Plus className="size-5" aria-hidden /> Add
          </Button>
        }
      />
      {suppliers.isLoading && <Spinner />}
      {suppliers.data?.length === 0 && <EmptyState title="No suppliers yet" />}
      {suppliers.data && suppliers.data.length > 0 && (
        <ResponsiveList
          rows={activeFirst(suppliers.data)}
          rowKey={(s) => s.id}
          title={(s) => s.name}
          subtitle={(s) => [s.email, s.phone].filter(Boolean).join(' · ')}
          badge={(s) => !s.active && <Badge>Off</Badge>}
          dimmed={(s) => !s.active}
          onSelect={(s) => setEditing(s.id)}
          columns={[
            { label: 'Name', cell: (s) => <span className="font-medium">{s.name}</span> },
            { label: 'Email', cell: (s) => s.email ?? '' },
            { label: 'Phone', cell: (s) => s.phone ?? '' },
            { label: 'Orders', cell: (s) => (s.order_method === 'email' ? 'Emailed by the app' : 'We order ourselves') },
            { label: 'Status', cell: (s) => (s.active ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>) },
          ]}
        />
      )}
      {editing && <SupplierSheet key={editing} supplier={current} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SupplierSheet({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    contact_name: supplier?.contact_name ?? '',
    email: supplier?.email ?? '',
    phone: supplier?.phone ?? '',
    order_method: supplier?.order_method ?? 'email',
    order_days: supplier?.order_days ?? '',
    minimum_order: supplier?.minimum_order?.toString() ?? '',
    notes: supplier?.notes ?? '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })
  const done = async () => {
    await refreshTables(queryClient, ['suppliers'])
    onClose()
  }
  const save = useAction(async () => {
    if (form.order_method === 'email' && !form.email.trim()) throw new Error('Add an email, or pick "We order ourselves".')
    const row = {
      name: form.name.trim(),
      contact_name: form.contact_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      order_method: form.order_method,
      order_days: form.order_days.trim() || null,
      minimum_order: num(form.minimum_order),
      notes: form.notes.trim() || null,
    }
    if (supplier) await updateRow('suppliers', supplier.id, row)
    else await insertRow('suppliers', row)
    await done()
  })
  const toggle = useAction(async () => {
    await updateRow('suppliers', supplier!.id, { active: !supplier!.active })
    await done()
  })
  const remove = useAction(async () => {
    await deleteRow('suppliers', supplier!.id)
    await done()
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }
  const error = save.error ?? toggle.error ?? remove.error

  return (
    <Sheet title={supplier ? supplier.name : 'Add a supplier'} open onClose={onClose} wide>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <Field label="Name" required autoFocus={!supplier} value={form.name} onChange={set('name')} className="sm:col-span-2" />
        <Field label="Contact person" value={form.contact_name} onChange={set('contact_name')} />
        <Field label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
        <Field label="Email" type="email" value={form.email} onChange={set('email')} className="sm:col-span-2" />
        <Select label="How they take orders" value={form.order_method} onChange={set('order_method')} className="sm:col-span-2">
          <option value="email">The app emails approved orders to them</option>
          <option value="self">We order ourselves (the app just keeps the list)</option>
        </Select>
        <Field label="Order days" placeholder="Order by Tuesday for Thursday" value={form.order_days} onChange={set('order_days')} />
        <Field
          label="Minimum order ($)"
          inputMode="decimal"
          value={form.minimum_order}
          onChange={set('minimum_order')}
          hint={num(form.minimum_order) ? `Orders under ${formatMoney(num(form.minimum_order)!)} get a warning.` : undefined}
        />
        <div className="sm:col-span-2">
          <TextArea label="Notes" value={form.notes} onChange={set('notes')} />
        </div>
        <div className="sm:col-span-2">
          <EditorActions
            isNew={!supplier}
            active={supplier?.active ?? true}
            saving={save.busy}
            onToggleActive={() => void toggle.run()}
            onDelete={() => void remove.run()}
            deleting={remove.busy}
          />
        </div>
      </form>
    </Sheet>
  )
}
