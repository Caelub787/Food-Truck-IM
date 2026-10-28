import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, Card, Notice, PageHeader, Spinner } from '@/components/ui'
import { deleteRow, insertRow, updateRow, useRows } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { useAction } from '@/lib/useAction'
import { BackLink } from './BackLink'
import { useTruckTypes, type Named } from './data'

type ListConfig = {
  table: string
  title: string
  hint: string
  placeholder: string
  /** An extra text field, like a group's base unit. */
  extra?: { key: string; label: string; placeholder: string; required?: boolean }
  sorted?: boolean
  truckType?: boolean
}

const lists: ListConfig[] = [
  {
    table: 'truck_types',
    title: 'Truck types',
    hint: 'Like "Shaved ice" and "Coffee". Supplies and products can be limited to a type, so drivers only see what their truck uses.',
    placeholder: 'New truck type',
  },
  {
    table: 'supply_groups',
    title: 'Supply groups',
    hint: 'For supplies a sale can\'t tell apart, like syrup flavors guests pick themselves. Recipes can use the group, and usage is compared on the group total.',
    placeholder: 'New group, like Syrups (any flavor)',
    extra: { key: 'base_unit', label: 'Base unit', placeholder: 'oz', required: true },
  },
  {
    table: 'waste_reasons',
    title: 'Waste reasons',
    hint: 'The choices drivers pick from when they log waste.',
    placeholder: 'New reason',
    sorted: true,
  },
  {
    table: 'free_reasons',
    title: 'Free drink reasons',
    hint: 'Why a drink was given away, like a drop replacement or an employee drink.',
    placeholder: 'New reason',
    sorted: true,
  },
  {
    table: 'checklist_items',
    title: 'Loading checklist',
    hint: 'Things drivers check off before heading out. Leave the truck type empty to show it on every truck.',
    placeholder: 'New checklist item',
    sorted: true,
    truckType: true,
  },
]

export function ListsPage() {
  return (
    <div>
      <BackLink />
      <PageHeader title="Lists" subtitle="Name these however your business talks about them." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {lists.map((list) => (
          <ListSection key={list.table} list={list} />
        ))}
      </div>
    </div>
  )
}

type Row = Named & Record<string, unknown>

function ListSection({ list }: { list: ListConfig }) {
  const queryClient = useQueryClient()
  const rows = useRows<Row>(list.table, { order: list.sorted ? 'sort,name' : 'name' })
  const types = useTruckTypes()
  const [name, setName] = useState('')
  const [extra, setExtra] = useState('')

  const refresh = () => refreshTables(queryClient, [list.table])
  const add = useAction(async () => {
    const sort = Math.max(0, ...(rows.data ?? []).map((r) => r.sort ?? 0)) + 1
    await insertRow(list.table, {
      name: name.trim(),
      ...(list.extra ? { [list.extra.key]: extra.trim() } : {}),
      ...(list.sorted ? { sort } : {}),
    })
    setName('')
    setExtra('')
    await refresh()
  })
  const change = useAction(async (id: string, patch: Record<string, unknown>) => {
    await updateRow(list.table, id, patch)
    await refresh()
  })
  const remove = useAction(async (id: string) => {
    await deleteRow(list.table, id)
    await refresh()
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) void add.run()
  }
  const error = add.error ?? change.error ?? remove.error

  return (
    <Card>
      <h2 className="text-lg font-semibold">{list.title}</h2>
      <p className="mt-1 text-sm text-slate-500">{list.hint}</p>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {rows.isLoading && <Spinner />}
      <ul className="mt-3 divide-y divide-slate-100">
        {(rows.data ?? []).map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
            <input
              // Remounts when someone else renames it, so the box shows the live name.
              key={row.name}
              aria-label={`${list.title} name`}
              defaultValue={row.name}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== row.name && void change.run(row.id, { name: e.target.value.trim() })}
              className={`min-h-11 min-w-0 flex-1 rounded-lg border border-transparent px-2 hover:border-slate-200 focus:border-brand-700 focus:outline-none ${row.active ? '' : 'text-slate-400 line-through'}`}
            />
            {list.extra && (
              <span className="rounded-lg bg-slate-100 px-2 py-1 text-sm text-slate-600">{String(row[list.extra.key] ?? '')}</span>
            )}
            {list.truckType && (
              <select
                aria-label="Truck type"
                value={(row.truck_type_id as string | null) ?? ''}
                onChange={(e) => void change.run(row.id, { truck_type_id: e.target.value || null })}
                className="min-h-11 rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="">All trucks</option>
                {(types.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => void change.run(row.id, { active: !row.active })}
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              {row.active ? 'Turn off' : 'Turn on'}
            </button>
            <button
              onClick={() => void remove.run(row.id)}
              aria-label={`Delete ${row.name}`}
              className="min-h-11 rounded-lg px-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="size-5" />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label={list.placeholder}
          placeholder={list.placeholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
        />
        {list.extra && (
          <input
            aria-label={list.extra.label}
            placeholder={list.extra.placeholder}
            required={list.extra.required}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            className="min-h-12 w-24 rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
          />
        )}
        <Button type="submit" variant="secondary" busy={add.busy} disabled={!name.trim()}>
          <Plus className="size-5" aria-hidden /> Add
        </Button>
      </form>
    </Card>
  )
}
