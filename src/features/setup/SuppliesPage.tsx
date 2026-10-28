import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState, SearchBox } from '@/components/forms'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Button, PageHeader, Select, Spinner } from '@/components/ui'
import { matchesSearch } from '@/lib/search'
import { findUnit, formatAmount, formatMoney } from '@/lib/units'
import { BackLink } from './BackLink'
import { activeFirst, useSuppliers, useSupplyCatalog } from './data'
import { SupplySheet } from './SupplySheet'

export function SuppliesPage() {
  const catalog = useSupplyCatalog()
  const suppliers = useSuppliers()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  const categories = useMemo(
    () => [...new Set((catalog.data?.supplies ?? []).map((s) => s.category).filter(Boolean) as string[])].sort(),
    [catalog.data],
  )
  const rows = activeFirst(catalog.data?.supplies).filter(
    (s) => (!category || s.category === category) && matchesSearch(search, s.name, s.category),
  )
  const supplierName = (id: string | null) => suppliers.data?.find((s) => s.id === id)?.name ?? ''
  const current = editing === 'new' ? null : (catalog.data?.supply(editing) ?? null)

  const countLabel = (id: string) => {
    const s = catalog.data!.supply(id)!
    return findUnit(catalog.data!.unitsOf(id), s.count_unit_id).name
  }
  const costLabel = (id: string) => {
    const s = catalog.data!.supply(id)!
    const unit = findUnit(catalog.data!.unitsOf(id), s.purchase_unit_id ?? s.count_unit_id)
    return s.cost_per_base > 0 ? `${formatMoney(Number(s.cost_per_base) * unit.factor)} / ${unit.name}` : ''
  }
  const reorderLabel = (id: string) => {
    const s = catalog.data!.supply(id)!
    if (s.reorder_level === null) return ''
    return formatAmount(Number(s.reorder_level), findUnit(catalog.data!.unitsOf(id), s.count_unit_id))
  }

  return (
    <div>
      <BackLink />
      <PageHeader
        title="Supplies"
        subtitle="Everything you stock: cups, syrup, milk, beans, lids, ice."
        action={
          <Button onClick={() => setEditing('new')} className="shrink-0">
            <Plus className="size-5" aria-hidden /> Add
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end">
        <SearchBox value={search} onChange={setSearch} placeholder="Find a supply" />
        {categories.length > 1 && (
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="md:w-56">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        )}
      </div>
      {catalog.isLoading && <Spinner />}
      {catalog.data?.supplies.length === 0 && (
        <EmptyState title="No supplies yet">Add them one at a time, use a starter kit, or import a spreadsheet from the Setup page.</EmptyState>
      )}
      {catalog.data && rows.length > 0 && (
        <ResponsiveList
          rows={rows}
          rowKey={(s) => s.id}
          title={(s) => s.name}
          subtitle={(s) => [s.category, `Counted in ${countLabel(s.id)}`, costLabel(s.id)].filter(Boolean).join(' · ')}
          badge={(s) => !s.active && <Badge>Off</Badge>}
          dimmed={(s) => !s.active}
          onSelect={(s) => setEditing(s.id)}
          columns={[
            { label: 'Name', cell: (s) => <span className="font-medium">{s.name}</span> },
            { label: 'Category', cell: (s) => s.category ?? '' },
            { label: 'Counted in', cell: (s) => countLabel(s.id) },
            { label: 'Cost', cell: (s) => costLabel(s.id) },
            { label: 'Reorder at', cell: (s) => reorderLabel(s.id) },
            { label: 'Supplier', cell: (s) => supplierName(s.supplier_id) },
            {
              label: 'Status',
              cell: (s) =>
                s.active ? (
                  <span className="flex flex-wrap gap-1">
                    <Badge tone="green">On</Badge>
                    {s.group_id && <Badge tone="blue">{catalog.data!.group(s.group_id)?.name}</Badge>}
                  </span>
                ) : (
                  <Badge>Off</Badge>
                ),
            },
          ]}
        />
      )}
      {editing && catalog.data && <SupplySheet key={editing} supply={current} catalog={catalog.data} onClose={() => setEditing(null)} />}
    </div>
  )
}
