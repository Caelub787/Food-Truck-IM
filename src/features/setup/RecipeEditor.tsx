import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Notice } from '@/components/ui'
import { num } from '@/lib/data'
import { findUnit } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import type { Catalog, RecipeLine } from './data'
import { newLineKey, type LineDraft } from './recipeLines'

/** Edits a list of {supply or group, amount, unit} lines and saves them as base amounts. */
export function RecipeEditor({
  catalog,
  initial,
  truckTypeId,
  onSave,
  saveLabel = 'Save recipe',
  emptyText = 'No recipe yet. Add what one of these uses.',
}: {
  catalog: Catalog
  initial: LineDraft[]
  truckTypeId?: string | null
  onSave: (lines: RecipeLine[]) => Promise<void>
  saveLabel?: string
  emptyText?: string
}) {
  const [lines, setLines] = useState<LineDraft[]>(initial)
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(lines.map(({ key: _k, ...rest }) => rest)) !== JSON.stringify(initial.map(({ key: _k, ...rest }) => rest))

  const supplies = catalog.supplies
    .filter((s) => (s.active && (!truckTypeId || !s.truck_type_id || s.truck_type_id === truckTypeId)) || lines.some((l) => l.target === `s:${s.id}`))
    .sort((a, b) => a.name.localeCompare(b.name))
  const groups = catalog.groups.filter((g) => g.active || lines.some((l) => l.target === `g:${g.id}`))

  const change = (k: string, patch: Partial<LineDraft>) => {
    setSaved(false)
    setLines(lines.map((l) => (l.key === k ? { ...l, ...patch } : l)))
  }

  const save = useAction(async () => {
    const out: RecipeLine[] = []
    for (const l of lines) {
      if (!l.target) throw new Error('Pick a supply for every line, or remove the empty line.')
      const amount = num(l.amount)
      if (amount === null || amount <= 0) throw new Error('Every line needs an amount bigger than 0.')
      const [kind, id] = l.target.split(':') as ['s' | 'g', string]
      const unit = kind === 's' ? findUnit(catalog.unitsOf(id), l.unit_id || null) : null
      out.push({
        supply_id: kind === 's' ? id : null,
        group_id: kind === 'g' ? id : null,
        quantity: amount * (unit?.factor ?? 1),
        unit_id: unit?.id ?? null,
      })
    }
    await onSave(out)
    setSaved(true)
  })

  return (
    <div className="flex flex-col gap-2">
      {save.error && <Notice tone="error">{save.error}</Notice>}
      {lines.length === 0 && <p className="text-sm text-slate-500">{emptyText}</p>}
      {lines.map((l) => {
        const [kind, id] = l.target.split(':')
        const units = kind === 's' && id ? catalog.unitsOf(id) : []
        const groupUnit = kind === 'g' && id ? catalog.group(id)?.base_unit : null
        return (
          <div key={l.key} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-2 sm:flex-row sm:items-center">
            <select
              aria-label="Supply"
              value={l.target}
              onChange={(e) => change(l.key, { target: e.target.value, unit_id: '' })}
              className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 sm:order-2 sm:w-auto sm:flex-1"
            >
              <option value="">Pick a supply</option>
              {groups.length > 0 && (
                <optgroup label="Groups (any of)">
                  {groups.map((g) => (
                    <option key={g.id} value={`g:${g.id}`}>
                      {g.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Supplies">
                {supplies.map((s) => (
                  <option key={s.id} value={`s:${s.id}`}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <div className="flex items-center gap-2 sm:order-1">
              <input
                aria-label="Amount"
                inputMode="decimal"
                placeholder="1"
                value={l.amount}
                onChange={(e) => change(l.key, { amount: e.target.value })}
                className="min-h-11 w-20 rounded-lg border border-slate-300 bg-white px-2"
              />
              {kind === 'g' ? (
                <span className="px-1 text-slate-600">{groupUnit}</span>
              ) : (
                <select
                  aria-label="Unit"
                  value={l.unit_id}
                  onChange={(e) => change(l.key, { unit_id: e.target.value })}
                  className="min-h-11 w-32 rounded-lg border border-slate-300 bg-white px-2"
                >
                  {units.length === 0 && <option value="">unit</option>}
                  {units.map((u) => (
                    <option key={u.id ?? 'base'} value={u.id ?? ''}>
                      {u.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                aria-label="Remove line"
                onClick={() => {
                  setSaved(false)
                  setLines(lines.filter((x) => x.key !== l.key))
                }}
                className="ml-auto min-h-11 rounded-lg px-2 text-slate-400 hover:bg-red-50 hover:text-red-600 sm:hidden"
              >
                <Trash2 className="size-5" />
              </button>
            </div>
            <button
              type="button"
              aria-label="Remove line"
              onClick={() => {
                setSaved(false)
                setLines(lines.filter((x) => x.key !== l.key))
              }}
              className="hidden min-h-11 rounded-lg px-2 text-slate-400 hover:bg-red-50 hover:text-red-600 sm:order-3 sm:block"
            >
              <Trash2 className="size-5" />
            </button>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setSaved(false)
            setLines([...lines, { key: newLineKey(), target: '', amount: '', unit_id: '' }])
          }}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 font-medium text-brand-700 hover:bg-brand-50"
        >
          <Plus className="size-5" aria-hidden /> Add a line
        </button>
        <div className="flex-1" />
        {saved && !dirty && <span className="text-sm text-emerald-700">Saved</span>}
        <Button type="button" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} busy={save.busy} onClick={() => void save.run()}>
          {saveLabel}
        </Button>
      </div>
    </div>
  )
}
