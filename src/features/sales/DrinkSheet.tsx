import { useState } from 'react'
import { CountInput } from '@/components/CountInput'
import { Segmented } from '@/components/forms'
import { Button, Notice, Select, Sheet } from '@/components/ui'
import { useModifiers, useProductModifierGroups, useProducts, useProductSizes, type Named } from '@/features/setup/data'
import { useRows } from '@/lib/data'
import { tallyKey, type TallyLine } from './useTallyDraft'

/** Adding drinks with add ons, or free drinks with a reason. */
export function DrinkSheet({
  open,
  onClose,
  onAdd,
  truckTypeId,
}: {
  open: boolean
  onClose: () => void
  onAdd: (line: TallyLine, quantity: number) => void
  truckTypeId: string | null | undefined
}) {
  const products = useProducts()
  const sizes = useProductSizes()
  const modifiers = useModifiers()
  const productGroups = useProductModifierGroups()
  const reasons = useRows<Named>('free_reasons', { order: 'sort,name' })
  const [productId, setProductId] = useState('')
  const [sizeId, setSizeId] = useState('')
  const [mods, setMods] = useState<string[]>([])
  const [free, setFree] = useState<'paid' | 'free'>('paid')
  const [reasonId, setReasonId] = useState('')
  const [count, setCount] = useState<number | null>(1)
  const [error, setError] = useState<string | null>(null)

  const productList = (products.data ?? []).filter((p) => p.active && (!truckTypeId || !p.truck_type_id || p.truck_type_id === truckTypeId))
  const sizeList = (sizes.data ?? []).filter((s) => s.active && s.product_id === productId)
  const size = sizeList.length === 1 ? sizeList[0]!.id : sizeId
  const groupIds = (productGroups.data ?? []).filter((g) => g.product_id === productId).map((g) => g.group_id)
  const modList = (modifiers.data ?? []).filter((m) => m.active && groupIds.includes(m.group_id))

  const add = () => {
    if (!size) return setError('Pick the drink and size.')
    if (!count || count <= 0) return setError('Enter how many.')
    if (free === 'free' && !reasonId) return setError('Pick why it was free.')
    const base = { product_size_id: size, modifier_ids: mods, is_free: free === 'free', free_reason_id: free === 'free' ? reasonId : null }
    onAdd({ ...base, key: tallyKey(base) }, count)
    setError(null)
    setMods([])
    setCount(1)
    onClose()
  }

  return (
    <Sheet title="Add drinks" open={open} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Segmented
          label="Paid or free"
          value={free}
          onChange={setFree}
          options={[
            { value: 'paid', label: 'Paid' },
            { value: 'free', label: 'Free' },
          ]}
        />
        {free === 'free' && (
          <Select label="Why was it free?" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
            <option value="">Pick a reason</option>
            {(reasons.data ?? [])
              .filter((r) => r.active)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </Select>
        )}
        <Select
          label="Drink"
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value)
            setSizeId('')
            setMods([])
          }}
        >
          <option value="">Pick one</option>
          {productList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {sizeList.length > 1 && (
          <Select label="Size" value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
            <option value="">Pick one</option>
            {sizeList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
        {modList.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Add ons</p>
            <div className="flex flex-wrap gap-2">
              {modList.map((m) => {
                const on = mods.includes(m.id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setMods(on ? mods.filter((x) => x !== m.id) : [...mods, m.id])}
                    className={`min-h-11 rounded-full px-4 font-medium ${on ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-slate-200'}`}
                  >
                    {m.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">How many</p>
          <CountInput label="How many drinks" unit="drinks" wholeOnly value={count} onChange={setCount} />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Button onClick={add} full>
          Add
        </Button>
      </div>
    </Sheet>
  )
}
