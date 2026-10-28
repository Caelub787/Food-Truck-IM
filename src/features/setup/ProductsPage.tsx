import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { EmptyState, SearchBox } from '@/components/forms'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Button, Field, Notice, PageHeader, Select, Sheet, Spinner } from '@/components/ui'
import { insertRow } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { matchesSearch } from '@/lib/search'
import { formatMoney } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { BackLink } from './BackLink'
import { activeFirst, useCurrentRecipes, useProducts, useProductSizes, useTruckTypes, type Product } from './data'

export function ProductsPage() {
  const navigate = useNavigate()
  const products = useProducts()
  const sizes = useProductSizes()
  const recipes = useCurrentRecipes()
  const types = useTruckTypes()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)

  const sizesOf = (p: Product) => (sizes.data ?? []).filter((s) => s.product_id === p.id && s.active)
  const missing = (p: Product) => sizesOf(p).filter((s) => !recipes.data?.get(s.id)?.lines.length).length
  const rows = activeFirst(products.data).filter((p) => matchesSearch(search, p.name, p.category))
  const typeName = (id: string | null) => types.data?.find((t) => t.id === id)?.name ?? ''
  const priceRange = (p: Product) => {
    const prices = sizesOf(p)
      .map((s) => s.price)
      .filter((x): x is number => x !== null)
      .map(Number)
    if (prices.length === 0) return ''
    const lo = Math.min(...prices)
    const hi = Math.max(...prices)
    return lo === hi ? formatMoney(lo) : `${formatMoney(lo)} to ${formatMoney(hi)}`
  }
  const status = (p: Product) =>
    !p.active ? (
      <Badge>Off</Badge>
    ) : sizesOf(p).length === 0 ? (
      <Badge tone="amber">No sizes</Badge>
    ) : missing(p) > 0 ? (
      <Badge tone="amber">{missing(p)} without recipe</Badge>
    ) : (
      <Badge tone="green">Ready</Badge>
    )

  return (
    <div>
      <BackLink />
      <PageHeader
        title="Products"
        subtitle="What you sell, its sizes, and what each size uses. Recipes let the app know how much should have been used."
        action={
          <Button onClick={() => setAdding(true)} className="shrink-0">
            <Plus className="size-5" aria-hidden /> Add
          </Button>
        }
      />
      <div className="mb-4">
        <SearchBox value={search} onChange={setSearch} placeholder="Find a product" />
      </div>
      {(products.isLoading || sizes.isLoading) && <Spinner />}
      {products.data?.length === 0 && (
        <EmptyState title="No products yet">Add them here, use a starter kit, or import a spreadsheet from the Setup page.</EmptyState>
      )}
      {rows.length > 0 && (
        <ResponsiveList
          rows={rows}
          rowKey={(p) => p.id}
          title={(p) => p.name}
          subtitle={(p) => [sizesOf(p).map((s) => s.name).join(', '), priceRange(p)].filter(Boolean).join(' · ')}
          badge={status}
          dimmed={(p) => !p.active}
          onSelect={(p) => navigate(`/setup/products/${p.id}`)}
          columns={[
            { label: 'Name', cell: (p) => <span className="font-medium">{p.name}</span> },
            { label: 'Category', cell: (p) => p.category ?? '' },
            { label: 'Sizes', cell: (p) => sizesOf(p).map((s) => s.name).join(', ') },
            { label: 'Price', cell: priceRange },
            { label: 'Truck type', cell: (p) => typeName(p.truck_type_id) || 'All' },
            { label: 'Status', cell: status },
          ]}
        />
      )}
      {adding && <NewProductSheet onClose={() => setAdding(false)} onCreated={(id) => navigate(`/setup/products/${id}`)} />}
    </div>
  )
}

function NewProductSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient()
  const types = useTruckTypes()
  const [form, setForm] = useState({ name: '', category: '', truck_type_id: '', sizes: 'Small, Medium, Large' })

  const create = useAction(async () => {
    const product = await insertRow<{ id: string }>('products', {
      name: form.name.trim(),
      category: form.category.trim() || null,
      truck_type_id: form.truck_type_id || null,
    })
    const names = form.sizes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const [i, name] of (names.length ? names : ['Regular']).entries()) {
      await insertRow('product_sizes', { product_id: product.id, name, sort: i })
    }
    await refreshTables(queryClient, ['products', 'product_sizes'])
    onCreated(product.id)
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void create.run()
  }

  return (
    <Sheet title="Add a product" open onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {create.error && <Notice tone="error">{create.error}</Notice>}
        <Field label="Name" required autoFocus placeholder="Latte" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field label="Category (optional)" placeholder="Hot drinks" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <Select label="Truck type" value={form.truck_type_id} onChange={(e) => setForm({ ...form, truck_type_id: e.target.value })}>
          <option value="">All trucks</option>
          {(types.data ?? [])
            .filter((t) => t.active)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </Select>
        <Field
          label="Sizes"
          hint='Separate with commas. Use one size like "Regular" if it only comes in one.'
          value={form.sizes}
          onChange={(e) => setForm({ ...form, sizes: e.target.value })}
        />
        <Button type="submit" busy={create.busy} full>
          Add and set up recipes
        </Button>
      </form>
    </Sheet>
  )
}
