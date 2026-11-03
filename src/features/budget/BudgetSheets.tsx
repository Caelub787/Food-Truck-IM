import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Toggle } from '@/components/forms'
import { Button, Field, Notice, Select, Sheet } from '@/components/ui'
import { num } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { supabase } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { autoLabels, type Category } from './data'

/** Typing in money spent or earned that the app can't see (fuel, payroll, a catering check). */
export function EntrySheet({ categories, defaultDate, onClose }: { categories: Category[]; defaultDate: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const active = categories.filter((c) => c.active)
  const [form, setForm] = useState({ category_id: active.find((c) => c.kind === 'expense' && !c.auto)?.id ?? active[0]?.id ?? '', entry_date: defaultDate, amount: '', note: '' })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })
  const save = useAction(async () => {
    const amount = num(form.amount)
    if (!amount || amount <= 0) throw new Error('Enter an amount more than zero.')
    const { error } = await supabase.from('budget_entries').insert({ category_id: form.category_id, entry_date: form.entry_date, amount, note: form.note.trim() || null })
    if (error) throw error
    await refreshTables(queryClient, ['budget_entries'])
    onClose()
  })
  const picked = categories.find((c) => c.id === form.category_id)

  return (
    <Sheet title="Add spending or income" open onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save.run()
        }}
      >
        <Select label="Category" value={form.category_id} onChange={set('category_id')}>
          <optgroup label="Money out">
            {active
              .filter((c) => c.kind === 'expense')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Money in">
            {active
              .filter((c) => c.kind === 'income')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </optgroup>
        </Select>
        {picked?.auto && (
          <Notice>
            {picked.name} fills in by itself ({autoLabels[picked.auto].toLowerCase()}). Only add what the app doesn't know about, so nothing counts twice.
          </Notice>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" type="date" required value={form.entry_date} onChange={set('entry_date')} />
          <Field label="Amount ($)" required inputMode="decimal" value={form.amount} onChange={set('amount')} />
        </div>
        <Field label="Note (optional)" placeholder="Gas for Truck 2" maxLength={300} value={form.note} onChange={set('note')} />
        {save.error && <Notice tone="error">{save.error}</Notice>}
        <Button type="submit" busy={save.busy} full>
          Add it
        </Button>
      </form>
    </Sheet>
  )
}

/** Naming budget categories, adding new ones, and turning off ones that aren't used. */
export function CategoriesSheet({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState({ name: '', kind: 'expense' as Category['kind'] })
  const refresh = () => refreshTables(queryClient, ['budget_categories'])
  const update = useAction(async (id: string, patch: Partial<Category>) => {
    const { error } = await supabase.from('budget_categories').update(patch).eq('id', id)
    if (error) throw error
    await refresh()
  })
  const add = useAction(async () => {
    if (!adding.name.trim()) throw new Error('Give the category a name.')
    const { error } = await supabase
      .from('budget_categories')
      .insert({ name: adding.name.trim(), kind: adding.kind, sort: Math.max(0, ...categories.map((c) => c.sort)) + 1 })
    if (error) throw error
    setAdding({ name: '', kind: adding.kind })
    await refresh()
  })

  return (
    <Sheet title="Budget categories" open onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        {(update.error || add.error) && <Notice tone="error">{update.error ?? add.error}</Notice>}
        {(['income', 'expense'] as const).map((kind) => (
          <section key={kind}>
            <h3 className="mb-2 font-semibold">{kind === 'income' ? 'Money in' : 'Money out'}</h3>
            <ul className="flex flex-col gap-2">
              {categories
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <li key={c.id} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center">
                    <input
                      aria-label="Category name"
                      defaultValue={c.name}
                      maxLength={60}
                      onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && void update.run(c.id, { name: e.target.value.trim() })}
                      className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3"
                    />
                    {c.auto && <span className="text-sm text-slate-500">{autoLabels[c.auto]}</span>}
                    <Toggle label="In use" checked={c.active} onChange={(v) => void update.run(c.id, { active: v })} />
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <form
          className="flex flex-col gap-3 rounded-xl border border-dashed border-slate-300 p-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            void add.run()
          }}
        >
          <Field label="New category" value={adding.name} maxLength={60} onChange={(e) => setAdding({ ...adding, name: e.target.value })} className="flex-1" />
          <Select label="Type" value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value as Category['kind'] })} className="sm:w-40">
            <option value="expense">Money out</option>
            <option value="income">Money in</option>
          </Select>
          <Button type="submit" busy={add.busy}>
            <Plus className="size-5" aria-hidden /> Add
          </Button>
        </form>
      </div>
    </Sheet>
  )
}
