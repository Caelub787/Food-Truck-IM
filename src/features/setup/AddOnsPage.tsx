import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { EmptyState } from '@/components/forms'
import { Button, Card, Field, Notice, PageHeader, Select, Sheet, Spinner } from '@/components/ui'
import { deleteRow, insertRow, num, updateRow } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { clean, findUnit, formatMoney } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { BackLink } from './BackLink'
import {
  useCurrentModifierEffects,
  useModifierGroups,
  useModifiers,
  useProductSizes,
  useSupplyCatalog,
  type Catalog,
  type Modifier,
  type ModifierEffect,
  type ModifierGroup,
} from './data'
import { describeLine } from './recipeLines'

export function AddOnsPage() {
  const groups = useModifierGroups()
  const modifiers = useModifiers()
  const effects = useCurrentModifierEffects()
  const catalog = useSupplyCatalog()
  const [editing, setEditing] = useState<{ modifier: Modifier | null; group: ModifierGroup } | null>(null)

  return (
    <div>
      <BackLink />
      <PageHeader
        title="Add ons"
        subtitle="Choices that change a drink, like oat milk or an extra shot. Tell the app what each one adds or swaps."
      />
      {(groups.isLoading || catalog.isLoading) && <Spinner />}
      {groups.data?.length === 0 && <EmptyState title="No add on groups yet">Start with a group like "Milk" or "Extras".</EmptyState>}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {(groups.data ?? []).map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            modifiers={(modifiers.data ?? []).filter((m) => m.group_id === g.id)}
            effects={effects.data}
            catalog={catalog.data}
            onEdit={(modifier) => setEditing({ modifier, group: g })}
          />
        ))}
        <NewGroupCard />
      </div>
      {editing && catalog.data && (
        <ModifierSheet
          key={editing.modifier?.id ?? 'new'}
          modifier={editing.modifier}
          group={editing.group}
          effects={editing.modifier ? (effects.data?.get(editing.modifier.id) ?? []) : []}
          catalog={catalog.data}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function describeEffect(e: ModifierEffect, catalog: Catalog | undefined) {
  if (!catalog) return ''
  const size = e.size_name ? ` (${e.size_name})` : ''
  if (e.kind === 'swap') {
    const from = e.supply_id ? catalog.supply(e.supply_id)?.name : catalog.group(e.group_id)?.name
    return `Swaps ${from ?? '?'} for ${catalog.supply(e.to_supply_id)?.name ?? '?'}${size}`
  }
  const q = Number(e.quantity)
  const text = describeLine({ supply_id: e.supply_id, group_id: e.group_id, quantity: Math.abs(q), unit_id: e.unit_id }, catalog)
  return `${q < 0 ? 'Takes away' : 'Adds'} ${text}${size}`
}

function GroupCard({
  group,
  modifiers,
  effects,
  catalog,
  onEdit,
}: {
  group: ModifierGroup
  modifiers: Modifier[]
  effects: Map<string, ModifierEffect[]> | undefined
  catalog: Catalog | undefined
  onEdit: (m: Modifier | null) => void
}) {
  const queryClient = useQueryClient()
  const change = useAction(async (patch: Record<string, unknown>) => {
    await updateRow('modifier_groups', group.id, patch)
    await refreshTables(queryClient, ['modifier_groups'])
  })
  const remove = useAction(async () => {
    await deleteRow('modifier_groups', group.id)
    await refreshTables(queryClient, ['modifier_groups', 'modifiers'])
  })
  const error = change.error ?? remove.error

  return (
    <Card className={group.active ? '' : 'opacity-70'}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          key={group.name}
          aria-label="Group name"
          defaultValue={group.name}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== group.name && void change.run({ name: e.target.value.trim() })}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-transparent px-2 text-lg font-semibold hover:border-slate-200 focus:border-brand-700 focus:outline-none"
        />
        <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => void change.run({ active: !group.active })}>
          {group.active ? 'Turn off' : 'Turn on'}
        </Button>
        <ConfirmButton variant="ghost" className="min-h-10 px-2 text-red-600" confirmLabel="Delete?" busy={remove.busy} onConfirm={() => void remove.run()}>
          <Trash2 className="size-5" aria-label="Delete group" />
        </ConfirmButton>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="mt-2 divide-y divide-slate-100">
        {modifiers.map((m) => (
          <li key={m.id}>
            <button onClick={() => onEdit(m)} className="flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left hover:bg-slate-50">
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${m.active ? '' : 'text-slate-400 line-through'}`}>
                  {m.name}
                  {Number(m.price) > 0 && <span className="font-normal text-slate-500"> +{formatMoney(Number(m.price))}</span>}
                </p>
                <p className="text-sm text-slate-500">
                  {(effects?.get(m.id) ?? []).map((e) => describeEffect(e, catalog)).join('. ') || 'Changes nothing in the recipe'}
                </p>
              </div>
              <span className="text-sm font-medium text-brand-700">Edit</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => onEdit(null)}
        className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 font-medium text-brand-700 hover:bg-brand-50"
      >
        <Plus className="size-5" aria-hidden /> Add an add on
      </button>
    </Card>
  )
}

function NewGroupCard() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const add = useAction(async () => {
    await insertRow('modifier_groups', { name: name.trim() })
    setName('')
    await refreshTables(queryClient, ['modifier_groups'])
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) void add.run()
  }
  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 className="font-semibold">New add on group</h2>
        {add.error && <Notice tone="error">{add.error}</Notice>}
        <Field label="Group name" placeholder="Milk, Extras, Flavor shots" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary" busy={add.busy} disabled={!name.trim()}>
          <Plus className="size-5" aria-hidden /> Add group
        </Button>
      </form>
    </Card>
  )
}

type EffectDraft = { key: string; kind: 'add' | 'swap'; size_name: string; target: string; amount: string; unit_id: string; to_supply_id: string }
let seq = 0
const nextKey = () => `e${++seq}`

function ModifierSheet({
  modifier,
  group,
  effects,
  catalog,
  onClose,
}: {
  modifier: Modifier | null
  group: ModifierGroup
  effects: ModifierEffect[]
  catalog: Catalog
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const sizes = useProductSizes()
  const sizeNames = [...new Set((sizes.data ?? []).map((s) => s.name))].sort()
  const [form, setForm] = useState({ name: modifier?.name ?? '', price: modifier?.price ? String(modifier.price) : '' })
  const [drafts, setDrafts] = useState<EffectDraft[]>(
    effects.map((e) => {
      const unit = e.supply_id ? findUnit(catalog.unitsOf(e.supply_id), e.unit_id) : null
      return {
        key: nextKey(),
        kind: e.kind,
        size_name: e.size_name ?? '',
        target: e.supply_id ? `s:${e.supply_id}` : `g:${e.group_id}`,
        amount: e.quantity === null ? '' : String(clean(Number(e.quantity) / (unit?.factor ?? 1), 4)),
        unit_id: unit?.id ?? '',
        to_supply_id: e.to_supply_id ?? '',
      }
    }),
  )
  const supplies = [...catalog.supplies].filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name))
  const change = (k: string, patch: Partial<EffectDraft>) => setDrafts(drafts.map((d) => (d.key === k ? { ...d, ...patch } : d)))

  const done = async () => {
    await refreshTables(queryClient, ['modifiers', 'modifier_versions', 'modifier_effects'])
    onClose()
  }
  const save = useAction(async () => {
    const out = drafts.map((d) => {
      if (!d.target) throw new Error('Pick a supply for every change, or remove the empty one.')
      const [kind, id] = d.target.split(':') as ['s' | 'g', string]
      if (d.kind === 'swap') {
        if (!d.to_supply_id) throw new Error('Pick what it swaps to.')
        return { kind: 'swap', size_name: d.size_name || null, supply_id: kind === 's' ? id : null, group_id: kind === 'g' ? id : null, to_supply_id: d.to_supply_id }
      }
      const amount = num(d.amount)
      if (amount === null || amount === 0) throw new Error('Every "adds" change needs an amount. Use a minus sign to take away.')
      const unit = kind === 's' ? findUnit(catalog.unitsOf(id), d.unit_id || null) : null
      return {
        kind: 'add',
        size_name: d.size_name || null,
        supply_id: kind === 's' ? id : null,
        group_id: kind === 'g' ? id : null,
        quantity: amount * (unit?.factor ?? 1),
        unit_id: unit?.id ?? null,
      }
    })
    let id = modifier?.id
    const row = { name: form.name.trim(), price: num(form.price) ?? 0 }
    if (id) await updateRow('modifiers', id, row)
    else id = (await insertRow<{ id: string }>('modifiers', { ...row, group_id: group.id })).id
    await rpc('save_modifier_effects', { p_modifier_id: id, p_effects: out })
    await done()
  })
  const toggle = useAction(async () => {
    await updateRow('modifiers', modifier!.id, { active: !modifier!.active })
    await done()
  })
  const remove = useAction(async () => {
    await deleteRow('modifiers', modifier!.id)
    await done()
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }
  const error = save.error ?? toggle.error ?? remove.error

  return (
    <Sheet title={modifier ? modifier.name : `Add to ${group.name}`} open onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required autoFocus={!modifier} placeholder="Oat milk" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field label="Extra price ($)" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </div>
        <div>
          <h3 className="font-semibold">What it changes</h3>
          <p className="text-sm text-slate-500">
            "Adds" puts more in (or takes away with a minus sign). "Swaps" moves whatever the recipe uses of one supply to another, like whole milk
            to oat milk.
          </p>
        </div>
        <datalist id="size-names">
          {sizeNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {drafts.map((d) => {
          const [kind, id] = d.target.split(':')
          const units = kind === 's' && id ? catalog.unitsOf(id) : []
          return (
            <div key={d.key} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
              <div className="flex flex-wrap gap-2">
                <Select label="Change" value={d.kind} onChange={(e) => change(d.key, { kind: e.target.value as 'add' | 'swap' })} className="w-32">
                  <option value="add">Adds</option>
                  <option value="swap">Swaps</option>
                </Select>
                <Field
                  label="Only for size (optional)"
                  list="size-names"
                  placeholder="Any size"
                  value={d.size_name}
                  onChange={(e) => change(d.key, { size_name: e.target.value })}
                  className="min-w-40 flex-1"
                />
                <button
                  type="button"
                  aria-label="Remove change"
                  onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}
                  className="mt-7 min-h-11 self-start rounded-lg px-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="size-5" />
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {d.kind === 'add' && (
                  <>
                    <Field label="Amount" inputMode="decimal" placeholder="1" value={d.amount} onChange={(e) => change(d.key, { amount: e.target.value })} className="w-24" />
                    {kind === 's' && (
                      <Select label="Unit" value={d.unit_id} onChange={(e) => change(d.key, { unit_id: e.target.value })} className="w-36">
                        {units.map((u) => (
                          <option key={u.id ?? 'base'} value={u.id ?? ''}>
                            {u.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </>
                )}
                <Select
                  label={d.kind === 'swap' ? 'Swaps this' : 'Of'}
                  value={d.target}
                  onChange={(e) => change(d.key, { target: e.target.value, unit_id: '' })}
                  className="min-w-40 flex-1"
                >
                  <option value="">Pick a supply</option>
                  {catalog.groups.length > 0 && (
                    <optgroup label="Groups">
                      {catalog.groups.map((g) => (
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
                </Select>
                {d.kind === 'swap' && (
                  <Select label="For this" value={d.to_supply_id} onChange={(e) => change(d.key, { to_supply_id: e.target.value })} className="min-w-40 flex-1">
                    <option value="">Pick a supply</option>
                    {supplies.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => setDrafts([...drafts, { key: nextKey(), kind: 'add', size_name: '', target: '', amount: '', unit_id: '', to_supply_id: '' }])}
          className="inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 font-medium text-brand-700 hover:bg-brand-50"
        >
          <Plus className="size-5" aria-hidden /> Add a change
        </button>
        <Button type="submit" busy={save.busy} full>
          {modifier ? 'Save' : 'Add'}
        </Button>
        {modifier && (
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => void toggle.run()}>
              {modifier.active ? 'Turn off (keeps history)' : 'Turn back on'}
            </Button>
            <ConfirmButton type="button" variant="ghost" className="flex-1 text-red-600" busy={remove.busy} confirmLabel="Tap again to delete" onConfirm={() => void remove.run()}>
              Delete
            </ConfirmButton>
          </div>
        )}
        <p className="text-sm text-slate-500">Changes only count from when you save. Old reports keep what was in effect.</p>
      </form>
    </Sheet>
  )
}
