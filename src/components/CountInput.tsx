import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { clean } from '@/lib/units'

const fractions: [string, number][] = [
  ['¼', 0.25],
  ['½', 0.5],
  ['¾', 0.75],
]

/**
 * A count box made for thumbs: type a number, or tap minus and plus, or tap
 * ¼ ½ ¾ to set the part after the whole number. Value is in the shown unit.
 */
export function CountInput({
  value,
  onChange,
  unit,
  wholeOnly,
  label,
  compact,
}: {
  value: number | null
  onChange: (value: number | null) => void
  unit: string
  wholeOnly?: boolean
  label: string
  compact?: boolean
}) {
  const [text, setText] = useState(value === null ? '' : String(clean(value)))
  // Follow changes made from outside (like a live update from a crew member).
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    const current = text === '' ? null : Number(text)
    if (value !== current) setText(value === null ? '' : String(clean(value)))
  }

  const set = (n: number | null) => {
    const next = n === null ? null : Math.max(0, clean(n))
    setText(next === null ? '' : String(next))
    onChange(next)
  }
  const whole = Math.floor(value ?? 0)
  const part = clean((value ?? 0) - whole)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`One less ${unit}`}
          onClick={() => set((value ?? 0) - 1)}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 active:bg-slate-100"
        >
          <Minus className="size-5" />
        </button>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{label}</span>
          <input
            inputMode="decimal"
            value={text}
            placeholder="0"
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9.]/g, '')
              setText(raw)
              if (raw === '') onChange(null)
              else if (!Number.isNaN(Number(raw))) onChange(wholeOnly ? Math.round(Number(raw)) : Number(raw))
            }}
            onBlur={() => wholeOnly && value !== null && set(Math.round(value))}
            className={`min-h-12 w-full rounded-xl border border-slate-300 bg-white pr-16 pl-3 text-lg font-semibold outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100 ${compact ? '' : 'text-center'}`}
          />
          <span className="pointer-events-none absolute top-1/2 right-3 max-w-14 -translate-y-1/2 truncate text-sm text-slate-500">{unit}</span>
        </label>
        <button
          type="button"
          aria-label={`One more ${unit}`}
          onClick={() => set((value ?? 0) + 1)}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 active:bg-slate-100"
        >
          <Plus className="size-5" />
        </button>
      </div>
      {!wholeOnly && (
        <div className="flex gap-1.5" role="group" aria-label="Part of one">
          {fractions.map(([symbol, f]) => (
            <button
              key={symbol}
              type="button"
              aria-pressed={part === f}
              onClick={() => set(whole + (part === f ? 0 : f))}
              className={`min-h-10 flex-1 rounded-lg text-base font-semibold ${
                part === f ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-700 active:bg-slate-200'
              }`}
            >
              {symbol}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
