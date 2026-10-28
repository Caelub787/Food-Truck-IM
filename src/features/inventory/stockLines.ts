import type { Catalog } from '@/features/setup/data'
import { clean, findUnit } from '@/lib/units'

export type StockLine = { key: string; supply_id: string; amount: string; unit_id: string; cost: string; expires_on: string }

let seq = 0
export const newLine = (patch: Partial<StockLine> = {}): StockLine => ({
  key: `s${++seq}`,
  supply_id: '',
  amount: '',
  unit_id: '',
  cost: '',
  expires_on: '',
  ...patch,
})

const addDays = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** A delivery line for a supply: its purchase unit, current cost, and usual expiration. */
export function deliveryLine(catalog: Catalog, supplyId: string, patch: Partial<StockLine> = {}): StockLine {
  const s = catalog.supply(supplyId)!
  const unit = findUnit(catalog.unitsOf(supplyId), s.purchase_unit_id ?? s.count_unit_id)
  return newLine({
    supply_id: supplyId,
    unit_id: unit.id ?? '',
    cost: Number(s.cost_per_base) > 0 ? String(clean(Number(s.cost_per_base) * unit.factor, 4)) : '',
    expires_on: s.tracks_expiration && s.shelf_life_days ? addDays(s.shelf_life_days) : '',
    ...patch,
  })
}

