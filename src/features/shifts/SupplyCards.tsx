import { Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { CountInput } from '@/components/CountInput'
import { SearchBox } from '@/components/forms'
import { Card } from '@/components/ui'
import type { Catalog, Supply } from '@/features/setup/data'
import { matchesSearch } from '@/lib/search'
import { findUnit } from '@/lib/units'

/**
 * A grid of supplies, each with a count box in its count unit. Values in and
 * out are in base units. One column on phones, more on bigger screens.
 */
export function SupplyCards({
  catalog: c,
  supplies,
  value,
  onChange,
  info,
  badge,
  highlight,
  disabled,
  addable,
  onAdd,
}: {
  catalog: Catalog
  supplies: Supply[]
  value: (supplyId: string) => number | null
  onChange: (supplyId: string, base: number | null) => void
  info?: (s: Supply) => ReactNode
  badge?: (s: Supply) => ReactNode
  highlight?: (s: Supply) => boolean
  disabled?: boolean
  /** Supplies that can be added to the list. */
  addable?: Supply[]
  onAdd?: (supplyId: string) => void
}) {
  const [search, setSearch] = useState('')
  const shown = supplies.filter((s) => matchesSearch(search, s.name, s.category))

  return (
    <div>
      {supplies.length > 8 && (
        <div className="mb-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Find a supply" />
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((s) => {
          const unit = findUnit(c.unitsOf(s.id), s.count_unit_id)
          const base = value(s.id)
          return (
            <Card key={s.id} className={highlight?.(s) ? 'ring-2 ring-amber-200' : ''}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{s.name}</p>
                  {info && <div className="text-sm text-slate-500">{info(s)}</div>}
                </div>
                {badge?.(s)}
              </div>
              {disabled ? null : (
                <CountInput
                  label={`${s.name} amount`}
                  unit={unit.name}
                  wholeOnly={s.whole_only}
                  value={base === null ? null : base / unit.factor}
                  onChange={(v) => onChange(s.id, v === null ? null : v * unit.factor)}
                />
              )}
            </Card>
          )
        })}
      </div>
      {addable && addable.length > 0 && onAdd && !disabled && (
        <label className="mt-3 flex min-h-12 items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 text-brand-700">
          <Plus className="size-5 shrink-0" aria-hidden />
          <span className="sr-only">Add a supply to the list</span>
          <select
            value=""
            onChange={(e) => e.target.value && onAdd(e.target.value)}
            className="min-h-12 flex-1 bg-transparent font-medium outline-none"
          >
            <option value="">Add something that's not on the list</option>
            {addable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

/** The bar that sticks to the bottom of the screen with the main button. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-20 z-20 mt-6 md:bottom-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 shadow-lg">{children}</Card>
    </div>
  )
}
