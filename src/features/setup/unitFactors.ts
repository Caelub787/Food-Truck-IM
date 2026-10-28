import { num } from '@/lib/data'

export type UnitDraft = { key: string; id?: string; name: string; amount: string; of: string }

/** Works out how many base units each unit holds, following "1 case = 6 half gallons". */
export function unitFactors(units: UnitDraft[], baseUnit: string): Map<string, number> {
  const factors = new Map<string, number>([['', 1]])
  const byName = new Map(units.map((u) => [u.name.trim().toLowerCase(), u]))
  const resolve = (name: string, depth: number): number => {
    const key = name.trim().toLowerCase()
    if (key === '' || key === baseUnit.trim().toLowerCase()) return 1
    if (factors.has(key)) return factors.get(key)!
    const unit = byName.get(key)
    if (!unit || depth > 10) return NaN
    const f = (num(unit.amount) ?? NaN) * resolve(unit.of, depth + 1)
    factors.set(key, f)
    return f
  }
  for (const u of units) resolve(u.name, 0)
  return factors
}

