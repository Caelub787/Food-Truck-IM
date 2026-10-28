import { Camera, X } from 'lucide-react'
import { useState } from 'react'
import { CountInput } from '@/components/CountInput'
import { Segmented, TextArea } from '@/components/forms'
import { Button, Notice, Select, Sheet } from '@/components/ui'
import { newClientId, type Place } from '@/features/inventory/data'
import {
  useModifiers,
  useProductModifierGroups,
  useProducts,
  useProductSizes,
  useSupplyCatalog,
  type Named,
} from '@/features/setup/data'
import type { Shift } from '@/features/shifts/data'
import { useRows } from '@/lib/data'
import { friendlyError } from '@/lib/errors'
import { sendOrQueue } from '@/lib/offline'
import { newPhotoPath, shrinkPhoto } from '@/lib/photos'
import { findUnit } from '@/lib/units'
import { useAction } from '@/lib/useAction'

const WASTE_TABLES = ['waste_logs', 'waste_lines', 'stock_levels', 'stock_movements', 'stock_batches']

/**
 * Logging waste: a supply (spilled milk) or whole drinks (a dropped cup), with a
 * reason and an optional photo. On a shift it comes off the truck. Managers can
 * also log waste at any place.
 */
export function WasteSheet({
  open,
  onClose,
  onSaved,
  companyId,
  shift,
  truckTypeId,
  places,
}: {
  open: boolean
  onClose: () => void
  onSaved: (message: string) => void
  companyId: string
  shift?: Shift
  truckTypeId?: string | null
  places?: Place[]
}) {
  const catalog = useSupplyCatalog()
  const products = useProducts()
  const sizes = useProductSizes()
  const modifiers = useModifiers()
  const productGroups = useProductModifierGroups()
  const reasons = useRows<Named>('waste_reasons', { order: 'sort,name' })
  const [what, setWhat] = useState<'supply' | 'drink'>('supply')
  const [placeId, setPlaceId] = useState('')
  const [supplyId, setSupplyId] = useState('')
  const [unitId, setUnitId] = useState<string | null | undefined>(undefined)
  const [amount, setAmount] = useState<number | null>(null)
  const [productId, setProductId] = useState('')
  const [sizeId, setSizeId] = useState('')
  const [mods, setMods] = useState<string[]>([])
  const [reasonId, setReasonId] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)

  const c = catalog.data
  const fits = (truckType: string | null) => !shift || !truckType || !truckTypeId || truckType === truckTypeId
  const supplyList = (c?.supplies ?? []).filter((s) => s.active && fits(s.truck_type_id))
  const productList = (products.data ?? []).filter((p) => p.active && fits(p.truck_type_id))
  const sizeList = (sizes.data ?? []).filter((s) => s.active && s.product_id === productId)
  const groupIds = (productGroups.data ?? []).filter((g) => g.product_id === productId).map((g) => g.group_id)
  const modList = (modifiers.data ?? []).filter((m) => m.active && groupIds.includes(m.group_id))
  const supply = c?.supply(supplyId)
  const units = supplyId && c ? c.unitsOf(supplyId) : []
  const unit = supply ? findUnit(units, unitId === undefined ? supply.count_unit_id : unitId) : null
  const place = shift ? shift.truck_id : placeId || places?.[0]?.id || ''

  const reset = () => {
    setSupplyId('')
    setUnitId(undefined)
    setAmount(null)
    setProductId('')
    setSizeId('')
    setMods([])
    setNote('')
    setPhoto(null)
  }

  const save = useAction(async () => {
    if (!amount || amount <= 0) throw new Error('Enter how much was wasted.')
    let label: string
    const p: Record<string, unknown> = {
      shift_id: shift?.id ?? null,
      place_id: shift ? null : place,
      reason_id: reasonId || null,
      note,
      client_id: newClientId(),
      quantity: what === 'supply' ? amount * (unit?.factor ?? 1) : amount,
    }
    if (what === 'supply') {
      if (!supply) throw new Error('Pick what was wasted.')
      p.supply_id = supply.id
      label = `Waste: ${supply.name}`
    } else {
      if (!sizeId) throw new Error('Pick the drink and size.')
      p.product_size_id = sizeId
      p.modifier_ids = mods
      label = `Waste: ${products.data?.find((x) => x.id === productId)?.name ?? 'drink'}`
    }
    let upload: { path: string; dataUrl: string } | undefined
    if (photo) {
      upload = { path: newPhotoPath(companyId, 'waste'), dataUrl: photo }
      p.photo_path = upload.path
    }
    const result = await sendOrQueue({ fn: 'log_waste', args: { p }, tables: WASTE_TABLES, label, upload }).catch((e: unknown) => {
      throw new Error(friendlyError(e))
    })
    onSaved(result === 'queued' ? "No signal. The waste is saved on this phone and will send when you're back online." : 'Waste logged.')
    reset()
    onClose()
  })

  const takePhoto = async (file: File | undefined) => {
    if (!file) return
    setPhotoBusy(true)
    try {
      setPhoto(await shrinkPhoto(file))
    } catch {
      save.setError("That photo couldn't be read. Try another one.")
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <Sheet title="Log waste" open={open} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save.run()
        }}
      >
        {!shift && places && (
          <Select label="Where" value={place} onChange={(e) => setPlaceId(e.target.value)}>
            {places.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name}
              </option>
            ))}
          </Select>
        )}
        <Segmented
          label="What was wasted"
          value={what}
          onChange={(v) => {
            setWhat(v)
            setAmount(null)
          }}
          options={[
            { value: 'supply', label: 'A supply' },
            { value: 'drink', label: 'Whole drinks' },
          ]}
        />

        {what === 'supply' ? (
          <>
            <Select
              label="Supply"
              value={supplyId}
              onChange={(e) => {
                setSupplyId(e.target.value)
                setUnitId(undefined)
              }}
            >
              <option value="">Pick one</option>
              {supplyList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            {supply && unit && (
              <>
                {units.length > 1 && (
                  <Select label="Counted in" value={unit.id ?? ''} onChange={(e) => setUnitId(e.target.value || null)}>
                    {units.map((u) => (
                      <option key={u.id ?? 'base'} value={u.id ?? ''}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                )}
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-700">How much</p>
                  <CountInput label="How much was wasted" unit={unit.name} wholeOnly={supply.whole_only && unit.id === null} value={amount} onChange={setAmount} />
                </div>
              </>
            )}
          </>
        ) : (
          <>
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
            {productId && (
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
              <p className="mb-1.5 text-sm font-medium text-slate-700">How many drinks</p>
              <CountInput label="How many drinks" unit="drinks" wholeOnly value={amount} onChange={setAmount} />
            </div>
          </>
        )}

        <Select label="Why" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          <option value="">Pick a reason</option>
          {(reasons.data ?? [])
            .filter((r) => r.active)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </Select>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Photo (optional)</p>
          {photo ? (
            <div className="relative size-40">
              <img src={photo} alt="Waste photo" className="size-40 rounded-xl object-cover" />
              <button
                type="button"
                onClick={() => setPhoto(null)}
                className="absolute top-2 right-2 rounded-full bg-white/90 p-2 shadow"
                aria-label="Remove photo"
              >
                <X className="size-5" />
              </button>
            </div>
          ) : (
            <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 font-medium text-brand-700 hover:bg-slate-50">
              <Camera className="size-5" aria-hidden />
              {photoBusy ? 'Shrinking photo…' : 'Take or pick a photo'}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void takePhoto(e.target.files?.[0])} />
            </label>
          )}
        </div>

        <TextArea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} />
        {save.error && <Notice tone="error">{save.error}</Notice>}
        <Button type="submit" busy={save.busy} full>
          Log waste
        </Button>
      </form>
    </Sheet>
  )
}
