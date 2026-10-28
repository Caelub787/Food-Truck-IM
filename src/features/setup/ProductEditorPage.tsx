import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Badge, Button, Card, Field, Notice, PageHeader, Select, Spinner } from '@/components/ui'
import { deleteRow, insertRow, num, updateRow } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { rpc, supabase } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { BackLink } from './BackLink'
import {
  useCurrentRecipes,
  useModifierGroups,
  useProductModifierGroups,
  useProducts,
  useProductSizes,
  useRecipeHistory,
  useSupplyCatalog,
  useTruckTypes,
  type Catalog,
  type Product,
  type ProductSize,
} from './data'
import { RecipeEditor } from './RecipeEditor'
import { lineDrafts } from './recipeLines'

export function ProductEditorPage() {
  const { id } = useParams()
  const products = useProducts()
  const sizes = useProductSizes()
  const catalog = useSupplyCatalog()
  const product = products.data?.find((p) => p.id === id)

  if (products.isLoading || sizes.isLoading || catalog.isLoading) return <Spinner />
  if (!product || !catalog.data) {
    return (
      <div>
        <BackLink to="/setup/products" label="Products" />
        <Notice tone="warning">This product was not found. Someone may have just deleted it.</Notice>
      </div>
    )
  }
  const productSizes = (sizes.data ?? []).filter((s) => s.product_id === product.id)

  return (
    <div>
      <BackLink to="/setup/products" label="Products" />
      <PageHeader title={product.name} subtitle="Sizes, prices, and what each size uses." />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {productSizes.map((size) => (
            <SizeCard key={size.id} size={size} product={product} catalog={catalog.data!} others={productSizes} />
          ))}
          <AddSizeCard product={product} count={productSizes.length} />
        </div>
        <div className="order-first flex flex-col gap-4 lg:order-none">
          <DetailsCard product={product} />
          <AddOnGroupsCard product={product} />
        </div>
      </div>
    </div>
  )
}

function DetailsCard({ product }: { product: Product }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const types = useTruckTypes()
  const [form, setForm] = useState({ name: product.name, category: product.category ?? '', truck_type_id: product.truck_type_id ?? '' })
  const [saved, setSaved] = useState(false)
  const refresh = () => refreshTables(queryClient, ['products'])

  const save = useAction(async () => {
    setSaved(false)
    await updateRow('products', product.id, {
      name: form.name.trim(),
      category: form.category.trim() || null,
      truck_type_id: form.truck_type_id || null,
    })
    await refresh()
    setSaved(true)
  })
  const toggle = useAction(async () => {
    await updateRow('products', product.id, { active: !product.active })
    await refresh()
  })
  const remove = useAction(async () => {
    await deleteRow('products', product.id)
    await refresh()
    navigate('/setup/products', { replace: true })
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }
  const error = save.error ?? toggle.error ?? remove.error

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Details</h2>
          {product.active ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {saved && <Notice tone="success">Saved.</Notice>}
        <Field label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <Select label="Truck type" value={form.truck_type_id} onChange={(e) => setForm({ ...form, truck_type_id: e.target.value })}>
          <option value="">All trucks</option>
          {(types.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Button type="submit" busy={save.busy}>
          Save details
        </Button>
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
          <Button type="button" variant="secondary" onClick={() => void toggle.run()}>
            {product.active ? 'Turn off (keeps history)' : 'Turn back on'}
          </Button>
          <ConfirmButton type="button" variant="ghost" className="text-red-600" busy={remove.busy} confirmLabel="Tap again to delete" onConfirm={() => void remove.run()}>
            Delete product
          </ConfirmButton>
        </div>
      </form>
    </Card>
  )
}

function SizeCard({ size, product, catalog, others }: { size: ProductSize; product: Product; catalog: Catalog; others: ProductSize[] }) {
  const queryClient = useQueryClient()
  const recipes = useCurrentRecipes()
  const history = useRecipeHistory([size.id])
  const current = recipes.data?.get(size.id)
  const [copyFrom, setCopyFrom] = useState<string | null>(null)
  const refresh = () => refreshTables(queryClient, ['product_sizes'])

  const rename = useAction(async (patch: Record<string, unknown>) => {
    await updateRow('product_sizes', size.id, patch)
    await refresh()
  })
  const remove = useAction(async () => {
    await deleteRow('product_sizes', size.id)
    await refresh()
  })
  const saveRecipe = async (lines: unknown[]) => {
    await rpc('save_recipe', { p_product_size_id: size.id, p_lines: lines })
    await refreshTables(queryClient, ['recipe_versions', 'recipe_lines'])
    setCopyFrom(null)
  }

  const source = copyFrom ? recipes.data?.get(copyFrom) : current
  const versions = history.data?.length ?? 0
  const error = rename.error ?? remove.error

  return (
    <Card className={size.active ? '' : 'opacity-70'}>
      <div className="flex flex-wrap items-end gap-3">
        <Field
          key={`n${size.name}`}
          label="Size"
          defaultValue={size.name}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== size.name && void rename.run({ name: e.target.value.trim() })}
          className="min-w-32 flex-1"
        />
        <Field
          key={`p${size.price}`}
          label="Price ($)"
          inputMode="decimal"
          defaultValue={size.price ?? ''}
          onBlur={(e) => num(e.target.value) !== (size.price === null ? null : Number(size.price)) && void rename.run({ price: num(e.target.value) })}
          className="w-28"
        />
        <Button type="button" variant="secondary" onClick={() => void rename.run({ active: !size.active })}>
          {size.active ? 'Turn off' : 'Turn on'}
        </Button>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Recipe for one {size.name.toLowerCase()}</h3>
        {others.length > 1 && (
          <select
            aria-label="Copy recipe from another size"
            value=""
            onChange={(e) => setCopyFrom(e.target.value || null)}
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
          >
            <option value="">Copy from another size</option>
            {others
              .filter((o) => o.id !== size.id && recipes.data?.get(o.id)?.lines.length)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        )}
      </div>
      <p className="mb-3 text-sm text-slate-500">
        {current
          ? `In use since ${new Date(current.since).toLocaleDateString()}.${versions > 1 ? ` ${versions - 1} earlier version${versions > 2 ? 's' : ''} kept for old reports.` : ''}`
          : 'Changes only count from the moment you save. Old reports keep the recipe they used.'}
      </p>
      <RecipeEditor
        key={`${current?.versionId ?? 'none'}:${copyFrom ?? ''}`}
        catalog={catalog}
        truckTypeId={product.truck_type_id}
        initial={lineDrafts(source?.lines ?? [], catalog)}
        onSave={saveRecipe}
      />
      <div className="mt-3 border-t border-slate-100 pt-3 text-right">
        <ConfirmButton
          type="button"
          variant="ghost"
          className="text-sm text-red-600"
          busy={remove.busy}
          confirmLabel="Tap again to delete this size"
          onConfirm={() => void remove.run()}
        >
          Delete size
        </ConfirmButton>
      </div>
    </Card>
  )
}

function AddSizeCard({ product, count }: { product: Product; count: number }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const add = useAction(async () => {
    await insertRow('product_sizes', { product_id: product.id, name: name.trim(), price: num(price), sort: count })
    setName('')
    setPrice('')
    await refreshTables(queryClient, ['product_sizes'])
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) void add.run()
  }
  return (
    <Card>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        {add.error && (
          <div className="w-full">
            <Notice tone="error">{add.error}</Notice>
          </div>
        )}
        <Field label="New size" placeholder="Extra large" value={name} onChange={(e) => setName(e.target.value)} className="min-w-32 flex-1" />
        <Field label="Price ($)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="w-28" />
        <Button type="submit" variant="secondary" busy={add.busy} disabled={!name.trim()}>
          <Plus className="size-5" aria-hidden /> Add size
        </Button>
      </form>
    </Card>
  )
}

function AddOnGroupsCard({ product }: { product: Product }) {
  const queryClient = useQueryClient()
  const groups = useModifierGroups()
  const links = useProductModifierGroups()
  const linked = new Set((links.data ?? []).filter((l) => l.product_id === product.id).map((l) => l.group_id))
  const toggle = useAction(async (groupId: string) => {
    if (linked.has(groupId)) {
      const { error } = await supabase.from('product_modifier_groups').delete().eq('product_id', product.id).eq('group_id', groupId)
      if (error) throw error
    } else {
      await insertRow('product_modifier_groups', { product_id: product.id, group_id: groupId })
    }
    await refreshTables(queryClient, ['product_modifier_groups'])
  })

  return (
    <Card>
      <h2 className="font-semibold">Add ons</h2>
      <p className="mt-1 text-sm text-slate-500">Which add on groups can go on this product, like milk choices or extra shots.</p>
      {toggle.error && (
        <div className="mt-3">
          <Notice tone="error">{toggle.error}</Notice>
        </div>
      )}
      {(groups.data ?? []).length === 0 && <p className="mt-3 text-sm text-slate-500">No add on groups yet. Set them up on the Add ons page.</p>}
      <ul className="mt-3 flex flex-col gap-1">
        {(groups.data ?? [])
          .filter((g) => g.active || linked.has(g.id))
          .map((g) => (
            <li key={g.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="size-5 accent-brand-700"
                  checked={linked.has(g.id)}
                  onChange={() => void toggle.run(g.id)}
                />
                {g.name}
              </label>
            </li>
          ))}
      </ul>
    </Card>
  )
}
