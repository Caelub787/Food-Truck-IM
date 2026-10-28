import { useModifiers, useProducts, useProductSizes, useSupplyCatalog } from '@/features/setup/data'
import type { WasteLog } from '@/features/shifts/data'
import { findUnit, formatAmount } from '@/lib/units'

/** "Whole milk: 1 half gallon" or "2 × Large Latte (Oat milk)". */
export function useWasteLabel() {
  const catalog = useSupplyCatalog()
  const products = useProducts()
  const sizes = useProductSizes()
  const modifiers = useModifiers()
  return (w: WasteLog) => {
    const c = catalog.data
    if (w.supply_id) {
      const s = c?.supply(w.supply_id)
      if (!s || !c) return ''
      return `${s.name}: ${formatAmount(Number(w.quantity), findUnit(c.unitsOf(s.id), s.count_unit_id))}`
    }
    const size = sizes.data?.find((x) => x.id === w.product_size_id)
    const product = products.data?.find((x) => x.id === size?.product_id)
    const mods = (w.modifier_ids ?? []).map((id) => modifiers.data?.find((m) => m.id === id)?.name).filter(Boolean)
    return `${Number(w.quantity)} × ${[size?.name, product?.name].filter(Boolean).join(' ')}${mods.length ? ` (${mods.join(', ')})` : ''}`
  }
}
