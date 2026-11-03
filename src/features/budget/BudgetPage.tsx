import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Plus, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Segmented } from '@/components/forms'
import { Badge, Button, Card, Notice, PageHeader, Spinner } from '@/components/ui'
import { downloadCsv } from '@/lib/csv'
import { num } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { rpc, supabase } from '@/lib/supabase'
import { formatMoney } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { CategoriesSheet, EntrySheet } from './BudgetSheets'
import { autoLabels, monthNames, monthStart, sumBy, useCategories, useEntries, useYear, type Category, type YearSheet } from './data'
import { MoneyCard } from './MoneyCard'

const whole = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/**
 * The budget: money on hand, and for each category what was planned and what
 * really happened, by month or for the whole year.
 */
export function BudgetPage() {
  const [today] = useState(() => new Date())
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [view, setView] = useState<'month' | 'year'>('month')
  const [sheet, setSheet] = useState<'entry' | 'categories' | null>(null)
  const categories = useCategories()
  const data = useYear(year)

  const step = (by: number) => {
    if (view === 'year') return setYear(year + by)
    const next = month + by
    if (next < 1) {
      setYear(year - 1)
      setMonth(12)
    } else if (next > 12) {
      setYear(year + 1)
      setMonth(1)
    } else setMonth(next)
  }
  const isThisMonth = year === today.getFullYear() && month === today.getMonth() + 1
  const defaultDate = isThisMonth ? today.toLocaleDateString('en-CA') : monthStart(year, month)

  return (
    <div>
      <PageHeader
        title="Budget"
        subtitle="Plan what you spend and earn each month. Inventory, sales, and booked events fill in by themselves."
        action={
          <Button className="shrink-0" onClick={() => setSheet('entry')} disabled={!categories.data}>
            <Plus className="size-5" aria-hidden /> Add spending
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <MoneyCard />

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Segmented
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'year', label: 'Whole year' },
            ]}
          />
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" aria-label={view === 'year' ? 'Last year' : 'Last month'} onClick={() => step(-1)}>
              <ChevronLeft className="size-5" aria-hidden />
            </Button>
            <p className="min-w-36 text-center font-semibold">{view === 'year' ? year : `${monthNames[month - 1]} ${year}`}</p>
            <Button variant="secondary" aria-label={view === 'year' ? 'Next year' : 'Next month'} onClick={() => step(1)}>
              <ChevronRight className="size-5" aria-hidden />
            </Button>
            <Button variant="ghost" onClick={() => setSheet('categories')} aria-label="Budget categories">
              <Settings2 className="size-5" aria-hidden />
              <span className="hidden sm:inline">Categories</span>
            </Button>
          </div>
        </div>

        {data.error && <Notice tone="error">{data.error.message}</Notice>}
        {(categories.isLoading || data.isLoading) && <Spinner />}
        {categories.data && data.data && view === 'month' && <MonthView year={year} month={month} categories={categories.data} sheet={data.data} />}
        {categories.data && data.data && view === 'year' && (
          <YearView
            year={year}
            categories={categories.data}
            sheet={data.data}
            onPickMonth={(m) => {
              setMonth(m)
              setView('month')
            }}
          />
        )}
      </div>

      {sheet === 'entry' && categories.data && <EntrySheet categories={categories.data} defaultDate={defaultDate} onClose={() => setSheet(null)} />}
      {sheet === 'categories' && categories.data && <CategoriesSheet categories={categories.data} onClose={() => setSheet(null)} />}
    </div>
  )
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'good' | 'bad' }) {
  return (
    <Card>
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-700' : ''}`}>{value}</p>
      {note && <p className="text-sm text-slate-500">{note}</p>}
    </Card>
  )
}

function MonthView({ year, month, categories, sheet }: { year: number; month: number; categories: Category[]; sheet: YearSheet }) {
  const queryClient = useQueryClient()
  const entries = useEntries(year, month)
  const budgets = sumBy(sheet.budgets, [month])
  const actuals = sumBy(sheet.actuals, [month])
  const shown = categories.filter((c) => c.active || budgets.get(c.id) || actuals.get(c.id))
  const total = (kind: Category['kind'], from: Map<string, number>) => shown.filter((c) => c.kind === kind).reduce((s, c) => s + (from.get(c.id) ?? 0), 0)
  const inActual = total('income', actuals)
  const outActual = total('expense', actuals)
  const outBudget = total('expense', budgets)

  const copyAhead = useAction(async () => {
    const months = Array.from({ length: 12 - month }, (_, i) => monthStart(year, month + i + 1))
    if (months.length === 0) throw new Error("This is the last month of the year. Pick an earlier month to copy from.")
    for (const c of shown) await rpc('set_budget', { p_category_id: c.id, p_months: months, p_amount: budgets.get(c.id) ?? 0 })
    await refreshTables(queryClient, ['budget_amounts'])
  })
  const removeEntry = useAction(async (id: string) => {
    const { error } = await supabase.from('budget_entries').delete().eq('id', id)
    if (error) throw error
    await refreshTables(queryClient, ['budget_entries'])
  })
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? ''

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Money in" value={formatMoney(inActual)} note={`Planned ${whole(total('income', budgets))}`} />
        <Tile label="Money out" value={formatMoney(outActual)} note={`Planned ${whole(outBudget)}`} />
        <Tile label="Left over" value={formatMoney(inActual - outActual)} tone={inActual - outActual < 0 ? 'bad' : 'good'} />
        <Tile
          label="Spending budget left"
          value={formatMoney(outBudget - outActual)}
          tone={outBudget - outActual < 0 ? 'bad' : undefined}
          note={outBudget ? `${Math.round((outActual / outBudget) * 100)}% used` : 'No budget set'}
        />
      </div>

      {(['expense', 'income'] as const).map((kind) => (
        <Card key={kind} flush>
          <div className="grid items-center gap-4 border-b border-slate-100 px-4 py-3 md:grid-cols-[minmax(0,1fr)_9rem_9rem_9rem]">
            <h2 className="font-semibold">{kind === 'income' ? 'Money in' : 'Money out'}</h2>
            <span className="hidden text-right text-sm text-slate-500 md:block">Budget</span>
            <span className="hidden text-right text-sm text-slate-500 md:block">{kind === 'income' ? 'Came in' : 'Spent'}</span>
            <span className="hidden text-right text-sm text-slate-500 md:block">{kind === 'income' ? 'To go' : 'Left'}</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {shown
              .filter((c) => c.kind === kind)
              .map((c) => {
                const budget = budgets.get(c.id) ?? 0
                const actual = actuals.get(c.id) ?? 0
                const left = budget - actual
                const over = kind === 'expense' && budget > 0 && actual > budget
                const pct = budget > 0 ? Math.min(100, (actual / budget) * 100) : 0
                return (
                  <li key={c.id} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_9rem_9rem_9rem] md:items-center md:gap-4">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {c.name} {!c.active && <Badge>Off</Badge>}
                      </p>
                      {c.auto && <p className="text-sm text-slate-500">{autoLabels[c.auto]}</p>}
                      {budget > 0 && (
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                          <div className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-brand-600'}`} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 md:contents">
                      <BudgetInput category={c} month={monthStart(year, month)} value={budget} />
                      <div className="md:text-right">
                        <p className="text-xs text-slate-500 md:hidden">{kind === 'income' ? 'Came in' : 'Spent'}</p>
                        <p className="font-semibold">{formatMoney(actual)}</p>
                      </div>
                      <div className="md:text-right">
                        <p className="text-xs text-slate-500 md:hidden">{kind === 'income' ? 'To go' : 'Left'}</p>
                        <p className={`font-semibold ${over ? 'text-red-600' : 'text-slate-600'}`}>{budget > 0 ? formatMoney(left) : ''}</p>
                      </div>
                    </div>
                  </li>
                )
              })}
          </ul>
        </Card>
      ))}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="secondary" busy={copyAhead.busy} onClick={() => void copyAhead.run()}>
          Use this month's budget for the rest of {year}
        </Button>
        {copyAhead.error && <Notice tone="error">{copyAhead.error}</Notice>}
      </div>

      <Card>
        <h2 className="font-semibold">Typed in this month</h2>
        {removeEntry.error && <Notice tone="error">{removeEntry.error}</Notice>}
        {(entries.data ?? []).length === 0 ? (
          <p className="mt-2 text-slate-500">Nothing yet. Use Add spending for things like fuel, payroll, or repairs.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {entries.data!.map((e) => (
              <li key={e.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{nameOf(e.category_id)}</p>
                  <p className="truncate text-sm text-slate-500">
                    {new Date(`${e.entry_date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    {e.note && ` · ${e.note}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="font-semibold">{formatMoney(Number(e.amount))}</span>
                  <button type="button" aria-label="Remove" onClick={() => void removeEntry.run(e.id)} className="grid size-11 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="size-5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

/** The budget for one category and month. Saves when you leave the box. */
function BudgetInput({ category, month, value }: { category: Category; month: string; value: number }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState(value ? String(value) : '')
  // Show changes someone else makes, unless this box is being edited.
  const [base, setBase] = useState(value)
  const [focused, setFocused] = useState(false)
  if (value !== base && !focused) {
    setBase(value)
    setText(value ? String(value) : '')
  }
  const save = useAction(async () => {
    const amount = num(text) ?? 0
    if (amount === value) return
    const { error } = await supabase.from('budget_amounts').upsert({ category_id: category.id, month, amount }, { onConflict: 'category_id,month' })
    if (error) throw error
    await refreshTables(queryClient, ['budget_amounts'])
  })
  return (
    <label className="flex flex-col">
      <span className="text-xs text-slate-500 md:sr-only">Budget</span>
      <span className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400">$</span>
        <input
          aria-label={`${category.name} budget`}
          inputMode="decimal"
          placeholder="0"
          value={text}
          onFocus={() => setFocused(true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setFocused(false)
            void save.run()
          }}
          className={`min-h-11 w-full rounded-lg border bg-white pr-2 pl-6 text-right ${save.error ? 'border-red-500' : 'border-slate-300'}`}
        />
      </span>
    </label>
  )
}

function YearView({ year, categories, sheet, onPickMonth }: { year: number; categories: Category[]; sheet: YearSheet; onPickMonth: (m: number) => void }) {
  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const cell = (cells: YearSheet['actuals'], id: string, m: number) => cells.filter((c) => c.category_id === id && c.month === m).reduce((s, c) => s + Number(c.amount), 0)
  const used = categories.filter((c) => c.active || sheet.actuals.some((a) => a.category_id === c.id) || sheet.budgets.some((b) => b.category_id === c.id))
  const totalFor = (kind: Category['kind'], cells: YearSheet['actuals'], m: number) => used.filter((c) => c.kind === kind).reduce((s, c) => s + cell(cells, c.id, m), 0)

  const csv = () =>
    downloadCsv(`budget-${year}.csv`, [
      ['Category', 'Type', ...months.flatMap((m) => [`${monthNames[m - 1]} budget`, `${monthNames[m - 1]} actual`])],
      ...used.map((c) => [c.name, c.kind === 'income' ? 'Money in' : 'Money out', ...months.flatMap((m) => [cell(sheet.budgets, c.id, m), cell(sheet.actuals, c.id, m)])]),
    ])

  const row = (label: string, actual: (m: number) => number, budget: (m: number) => number, opts: { bold?: boolean; expense?: boolean } = {}) => {
    const sumA = months.reduce((s, m) => s + actual(m), 0)
    const sumB = months.reduce((s, m) => s + budget(m), 0)
    const box = (a: number, b: number) => (
      <>
        <span className={`block font-semibold ${opts.expense && b > 0 && a > b ? 'text-red-600' : ''}`}>{a ? whole(a) : ''}</span>
        {b > 0 && <span className="block text-xs text-slate-500">of {whole(b)}</span>}
      </>
    )
    return (
      <tr key={label} className={opts.bold ? 'bg-slate-50 font-semibold' : ''}>
        <th scope="row" className="sticky left-0 z-10 bg-inherit px-3 py-2 text-left font-medium whitespace-nowrap">
          <span className={opts.bold ? 'font-bold' : ''}>{label}</span>
        </th>
        {months.map((m) => (
          <td key={m} className="px-2 py-1.5 text-right">
            <button type="button" onClick={() => onPickMonth(m)} className="w-full min-w-16 rounded-lg px-1 py-1 text-right hover:bg-brand-50" aria-label={`${label}, ${monthNames[m - 1]}`}>
              {box(actual(m), budget(m))}
            </button>
          </td>
        ))}
        <td className="px-3 py-1.5 text-right">{box(sumA, sumB)}</td>
      </tr>
    )
  }

  return (
    <Card flush>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-500">Each box shows what really happened, and the budget under it. Tap a month to change it.</p>
        <Button variant="secondary" onClick={csv} className="shrink-0">
          <Download className="size-5" aria-hidden /> CSV
        </Button>
      </div>
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium">Category</th>
              {months.map((m) => (
                <th key={m} className="px-2 py-2 text-right font-medium">
                  {monthNames[m - 1]}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Year</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {(['income', 'expense'] as const).flatMap((kind) => [
              ...used
                .filter((c) => c.kind === kind)
                .map((c) => row(c.name, (m) => cell(sheet.actuals, c.id, m), (m) => cell(sheet.budgets, c.id, m), { expense: kind === 'expense' })),
              row(
                kind === 'income' ? 'All money in' : 'All money out',
                (m) => totalFor(kind, sheet.actuals, m),
                (m) => totalFor(kind, sheet.budgets, m),
                { bold: true, expense: kind === 'expense' },
              ),
            ])}
            {row('Left over', (m) => totalFor('income', sheet.actuals, m) - totalFor('expense', sheet.actuals, m), () => 0, { bold: true })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
