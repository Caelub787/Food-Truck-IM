import { Plus, Trash2 } from 'lucide-react'
import type { Catalog } from '@/features/setup/data'
import { findUnit, formatAmount } from '@/lib/units'
import { newLine, type StockLine } from './stockLines'

/** Rows of supply, amount, and unit, with optional cost and expiration columns. */
export function LinesEditor({
  catalog,
  lines,
  onChange,
  withCost,
  withExpiration,
  available,
  supplyFilter,
  onSupplyPicked,
}: {
  catalog: Catalog
  lines: StockLine[]
  onChange: (lines: StockLine[]) => void
  withCost?: boolean
  withExpiration?: boolean
  available?: (supplyId: string) => number | null
  supplyFilter?: (supplyId: string) => boolean
  onSupplyPicked?: (line: StockLine, supplyId: string) => Partial<StockLine>
}) {
  const supplies = catalog.supplies.filter((s) => s.active && (!supplyFilter || supplyFilter(s.id))).sort((a, b) => a.name.localeCompare(b.name))
  const set = (key: string, patch: Partial<StockLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <div className="flex flex-col gap-2">
      {lines.map((l) => {
        const supply = catalog.supply(l.supply_id)
        const units = l.supply_id ? catalog.unitsOf(l.supply_id) : []
        const have = l.supply_id && available ? available(l.supply_id) : null
        return (
          <div key={l.key} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <select
                aria-label="Supply"
                value={l.supply_id}
                onChange={(e) => set(l.key, { supply_id: e.target.value, unit_id: '', ...(onSupplyPicked?.(l, e.target.value) ?? {}) })}
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2"
              >
                <option value="">Pick a supply</option>
                {supplies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Remove line"
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                className="min-h-11 rounded-lg px-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="size-5" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Amount"
                inputMode="decimal"
                placeholder="Amount"
                value={l.amount}
                onChange={(e) => set(l.key, { amount: e.target.value })}
                className="min-h-11 w-24 rounded-lg border border-slate-300 bg-white px-2"
              />
              <select
                aria-label="Unit"
                value={l.unit_id}
                onChange={(e) => set(l.key, { unit_id: e.target.value })}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-2"
              >
                {units.length === 0 && <option value="">unit</option>}
                {units.map((u) => (
                  <option key={u.id ?? 'base'} value={u.id ?? ''}>
                    {u.name}
                  </option>
                ))}
              </select>
              {withCost && (
                <label className="flex items-center gap-1 text-sm text-slate-600">
                  $
                  <input
                    aria-label="Cost for each"
                    inputMode="decimal"
                    placeholder="Cost each"
                    value={l.cost}
                    onChange={(e) => set(l.key, { cost: e.target.value })}
                    className="min-h-11 w-24 rounded-lg border border-slate-300 bg-white px-2"
                  />
                  each
                </label>
              )}
              {withExpiration && supply?.tracks_expiration && (
                <label className="flex items-center gap-1 text-sm text-slate-600">
                  Expires
                  <input
                    type="date"
                    aria-label="Expiration date"
                    value={l.expires_on}
                    onChange={(e) => set(l.key, { expires_on: e.target.value })}
                    className="min-h-11 rounded-lg border border-slate-300 bg-white px-2"
                  />
                </label>
              )}
              {have !== null && supply && (
                <span className={`text-sm ${have <= 0 ? 'text-red-600' : 'text-slate-500'}`}>
                  {formatAmount(have, findUnit(units, supply.count_unit_id))} there now
                </span>
              )}
            </div>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => onChange([...lines, newLine()])}
        className="inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 font-medium text-brand-700 hover:bg-brand-50"
      >
        <Plus className="size-5" aria-hidden /> Add a line
      </button>
    </div>
  )
}
