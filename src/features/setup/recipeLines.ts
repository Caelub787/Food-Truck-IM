import { clean, findUnit, formatAmount } from '@/lib/units'
import type { Catalog, RecipeLine } from './data'

export type LineDraft = { key: string; target: string; amount: string; unit_id: string }

let seq = 0
export const newLineKey = () => `l${++seq}`

/** "s:<id>" for a supply, "g:<id>" for a group. */
export const targetOf = (l: { supply_id: string | null; group_id: string | null }) =>
  l.supply_id ? `s:${l.supply_id}` : `g:${l.group_id}`

export function lineDrafts(lines: RecipeLine[], catalog: Catalog): LineDraft[] {
  return lines.map((l) => {
    const units = l.supply_id ? catalog.unitsOf(l.supply_id) : []
    const unit = l.supply_id ? findUnit(units, l.unit_id) : null
    return {
      key: newLineKey(),
      target: targetOf(l),
      amount: String(clean(Number(l.quantity) / (unit?.factor ?? 1), 4)),
      unit_id: unit?.id ?? '',
    }
  })
}

export function describeLine(l: RecipeLine, catalog: Catalog) {
  if (l.group_id) {
    const g = catalog.group(l.group_id)
    return `${formatAmount(Number(l.quantity), { id: null, name: g?.base_unit ?? '', factor: 1 })} ${g?.name ?? 'group'}`
  }
  const units = catalog.unitsOf(l.supply_id!)
  return `${formatAmount(Number(l.quantity), findUnit(units, l.unit_id))} ${catalog.supply(l.supply_id)?.name ?? 'supply'}`
}

