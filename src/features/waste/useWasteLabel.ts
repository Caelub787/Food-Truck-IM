import { useDrinkLabel } from '@/features/sales/useDrinkLabel'
import { useSupplyCatalog } from '@/features/setup/data'
import type { WasteLog } from '@/features/shifts/data'
import { findUnit, formatAmount } from '@/lib/units'

/** "Whole milk: 1 half gallon" or "2 × Large Latte + Oat milk". */
export function useWasteLabel() {
  const catalog = useSupplyCatalog()
  const drink = useDrinkLabel()
  return (w: WasteLog) => {
    const c = catalog.data
    if (w.supply_id) {
      const s = c?.supply(w.supply_id)
      if (!s || !c) return ''
      return `${s.name}: ${formatAmount(Number(w.quantity), findUnit(c.unitsOf(s.id), s.count_unit_id))}`
    }
    return `${Number(w.quantity)} × ${drink.label(w.product_size_id, w.modifier_ids)}`
  }
}
