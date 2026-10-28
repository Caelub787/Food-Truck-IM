// Every amount is stored in a supply's base unit (oz, g, each). Other units say
// how many base units they hold (half gallon = 64 oz). These helpers convert and
// show amounts in whatever unit people actually use.

export type Unit = { id: string | null; name: string; factor: number }
export type UnitRow = { id: string; supply_id: string; name: string; factor: number | string }
export type SupplyUnits = { base_unit: string; count_unit_id: string | null; purchase_unit_id: string | null }

/** The base unit first, then the supply's other units, smallest to biggest. */
export function unitsFor(supply: SupplyUnits & { id: string }, rows: UnitRow[]): Unit[] {
  const extra = rows
    .filter((u) => u.supply_id === supply.id)
    .map((u) => ({ id: u.id, name: u.name, factor: Number(u.factor) }))
    .sort((a, b) => a.factor - b.factor)
  return [{ id: null, name: supply.base_unit, factor: 1 }, ...extra]
}

export function findUnit(units: Unit[], id: string | null | undefined): Unit {
  return units.find((u) => u.id === (id ?? null)) ?? units[0]!
}

export const toBase = (amount: number, unit: Unit) => amount * unit.factor
export const fromBase = (base: number, unit: Unit) => base / unit.factor

/** Rounds away floating point noise: 0.30000000000000004 becomes 0.3. */
export function clean(n: number, places = 3) {
  const f = 10 ** places
  return Math.round(n * f) / f
}

export function formatNumber(n: number, places = 2) {
  return clean(n, places).toLocaleString(undefined, { maximumFractionDigits: places })
}

const noPlural = new Set(['oz', 'fl oz', 'g', 'kg', 'lb', 'lbs', 'ml', 'l', 'each', 'ea', 'gal', 'qt', 'pt', 'pcs'])

export function unitLabel(name: string, amount: number) {
  const lower = name.toLowerCase()
  if (Math.abs(amount) === 1 || noPlural.has(lower) || lower.endsWith('s')) return name
  if (lower.endsWith('ch') || lower.endsWith('sh') || lower.endsWith('x')) return `${name}es`
  return `${name}s`
}

/** "6.5 half gallons" for an amount in base units shown in the given unit. */
export function formatAmount(base: number, unit: Unit, places = 2) {
  const n = clean(fromBase(base, unit), places)
  return `${formatNumber(n, places)} ${unitLabel(unit.name, n)}`
}

/** Shows a base amount in the count unit, with the base amount after it when that helps. */
export function describeAmount(base: number, units: Unit[], countUnitId: string | null) {
  const count = findUnit(units, countUnitId)
  if (count.id === null) return formatAmount(base, count)
  return `${formatAmount(base, count)} (${formatAmount(base, units[0]!)})`
}

/** Money with cents, or more digits for tiny per unit costs like $0.0123 per oz. */
export function formatMoney(n: number) {
  const abs = Math.abs(n)
  const digits = abs > 0 && abs < 0.1 ? 4 : 2
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: digits })
}
