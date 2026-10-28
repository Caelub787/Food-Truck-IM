import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { TextArea, Toggle } from '@/components/forms'
import { Field, Notice, Select, Sheet } from '@/components/ui'
import { useSettings } from '@/features/settings/useSettings'
import { deleteRow, num, updateRow } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { clean, findUnit, formatMoney } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { useSuppliers, useTruckTypes, type Catalog, type Supply } from './data'
import { EditorActions } from './EditorActions'
import { unitFactors, type UnitDraft } from './unitFactors'

const commonUnits = ['each', 'oz', 'fl oz', 'g', 'lb', 'ml']

let keySeq = 0
const nextKey = () => `u${++keySeq}`

export function SupplySheet({ supply, catalog, onClose }: { supply: Supply | null; catalog: Catalog; onClose: () => void }) {
  const queryClient = useQueryClient()
  const suppliers = useSuppliers()
  const types = useTruckTypes()
  const settings = useSettings()
  const existingUnits = supply ? catalog.unitsOf(supply.id) : []
  const countUnit = supply ? findUnit(existingUnits, supply.count_unit_id) : null
  const costUnit = supply ? findUnit(existingUnits, supply.purchase_unit_id ?? supply.count_unit_id) : null
  const countFactor = countUnit?.factor ?? 1

  const [form, setForm] = useState({
    name: supply?.name ?? '',
    category: supply?.category ?? '',
    base_unit: supply?.base_unit ?? 'each',
    units: existingUnits.slice(1).map<UnitDraft>((u) => ({ key: nextKey(), id: u.id!, name: u.name, amount: String(clean(u.factor, 4)), of: '' })),
    count_unit: countUnit?.id ? countUnit.name : '',
    purchase_unit: supply?.purchase_unit_id ? findUnit(existingUnits, supply.purchase_unit_id).name : '',
    cost: supply && supply.cost_per_base > 0 ? String(clean(Number(supply.cost_per_base) * (costUnit?.factor ?? 1), 4)) : '',
    cost_unit: costUnit?.id ? costUnit.name : '',
    supplier_id: supply?.supplier_id ?? '',
    truck_type_id: supply?.truck_type_id ?? '',
    group_id: supply?.group_id ?? '',
    reorder_level: supply?.reorder_level != null ? String(clean(Number(supply.reorder_level) / countFactor)) : '',
    order_up_to: supply?.order_up_to != null ? String(clean(Number(supply.order_up_to) / countFactor)) : '',
    whole_only: supply?.whole_only ?? false,
    tracks_expiration: supply?.tracks_expiration ?? false,
    shelf_life_days: supply?.shelf_life_days?.toString() ?? '',
    count_check: supply?.count_check ?? false,
    diff_percent: supply?.diff_percent?.toString() ?? '',
    diff_min_qty: supply?.diff_min_qty != null ? String(clean(Number(supply.diff_min_qty) / countFactor)) : '',
    notes: supply?.notes ?? '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })
  const setUnit = (key: string, patch: Partial<UnitDraft>) =>
    setForm({ ...form, units: form.units.map((u) => (u.key === key ? { ...u, ...patch } : u)) })
  // Renaming a unit keeps everything that pointed at it pointing at it.
  const renameUnit = (key: string, from: string, to: string) => {
    const follow = (v: string) => (v && v === from ? to : v)
    setForm({
      ...form,
      units: form.units.map((u) => (u.key === key ? { ...u, name: to } : { ...u, of: follow(u.of) })),
      count_unit: follow(form.count_unit),
      purchase_unit: follow(form.purchase_unit),
      cost_unit: follow(form.cost_unit),
    })
  }

  const factors = unitFactors(form.units, form.base_unit)
  const factorOf = (name: string) => factors.get(name.trim().toLowerCase()) ?? 1
  const unitNames = form.units.map((u) => u.name.trim()).filter(Boolean)
  const countName = form.count_unit || form.base_unit
  const groups = catalog.groups.filter((g) => g.active || g.id === form.group_id)

  const done = async () => {
    await refreshTables(queryClient, ['supplies', 'supply_units'])
    onClose()
  }

  const save = useAction(async () => {
    const seen = new Set<string>([form.base_unit.trim().toLowerCase()])
    for (const u of form.units) {
      const key = u.name.trim().toLowerCase()
      if (!key) throw new Error('Every unit needs a name.')
      if (seen.has(key)) throw new Error(`"${u.name}" is listed twice. Each unit needs its own name.`)
      seen.add(key)
      if (!(factorOf(u.name) > 0)) throw new Error(`Say how much "${u.name}" holds.`)
    }
    const cf = factorOf(form.count_unit)
    const cost = num(form.cost)
    await rpc('save_supply', {
      p: {
        id: supply?.id,
        name: form.name,
        category: form.category,
        base_unit: form.base_unit,
        units: form.units.map((u) => ({ id: u.id, name: u.name.trim(), factor: factorOf(u.name) })),
        count_unit: form.count_unit,
        purchase_unit: form.purchase_unit,
        cost_per_base: cost === null ? 0 : cost / factorOf(form.cost_unit),
        supplier_id: form.supplier_id,
        truck_type_id: form.truck_type_id,
        group_id: form.group_id,
        reorder_level: num(form.reorder_level) === null ? null : num(form.reorder_level)! * cf,
        order_up_to: num(form.order_up_to) === null ? null : num(form.order_up_to)! * cf,
        whole_only: form.whole_only,
        tracks_expiration: form.tracks_expiration,
        shelf_life_days: num(form.shelf_life_days),
        count_check: form.count_check,
        diff_percent: num(form.diff_percent),
        diff_min_qty: num(form.diff_min_qty) === null ? null : num(form.diff_min_qty)! * cf,
        notes: form.notes,
        active: supply?.active ?? true,
      },
    })
    await done()
  })
  const toggle = useAction(async () => {
    await updateRow('supplies', supply!.id, { active: !supply!.active })
    await done()
  })
  const remove = useAction(async () => {
    await deleteRow('supplies', supply!.id)
    await done()
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }
  const error = save.error ?? toggle.error ?? remove.error
  const categories = [...new Set(catalog.supplies.map((s) => s.category).filter(Boolean) as string[])]

  return (
    <Sheet title={supply ? supply.name : 'Add a supply'} open onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-5">
        {error && <Notice tone="error">{error}</Notice>}

        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required autoFocus={!supply} value={form.name} onChange={set('name')} className="sm:col-span-2" />
          <Field label="Category" list="supply-categories" placeholder="Dairy, Cups, Syrup" value={form.category} onChange={set('category')} />
          <datalist id="supply-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <Field
            label="Base unit"
            list="base-units"
            required
            hint="The smallest unit recipes use, like oz, g, or each."
            value={form.base_unit}
            onChange={set('base_unit')}
          />
          <datalist id="base-units">
            {commonUnits.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </section>

        <section>
          <h3 className="font-semibold">Other units</h3>
          <p className="text-sm text-slate-500">How it comes and how drivers count it, like a half gallon, a sleeve, or a case.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {form.units.map((u, i) => (
              <li key={u.key} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-2 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-2">
                  <span className="text-slate-500">1</span>
                  <input
                    aria-label="Unit name"
                    placeholder="half gallon"
                    value={u.name}
                    onChange={(e) => renameUnit(u.key, u.name, e.target.value)}
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">holds</span>
                  <input
                    aria-label={`How much one ${u.name || 'unit'} holds`}
                    inputMode="decimal"
                    placeholder="64"
                    value={u.amount}
                    onChange={(e) => setUnit(u.key, { amount: e.target.value })}
                    className="min-h-11 w-20 rounded-lg border border-slate-300 bg-white px-2"
                  />
                  <select
                    aria-label="Measured in"
                    value={u.of}
                    onChange={(e) => setUnit(u.key, { of: e.target.value })}
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 sm:w-32 sm:flex-none"
                  >
                    <option value="">{form.base_unit || 'base unit'}</option>
                    {form.units.slice(0, i).map((o) => (
                      <option key={o.key} value={o.name}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove ${u.name || 'unit'}`}
                    onClick={() => setForm({ ...form, units: form.units.filter((x) => x.key !== u.key) })}
                    className="min-h-11 rounded-lg px-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setForm({ ...form, units: [...form.units, { key: nextKey(), name: '', amount: '', of: '' }] })}
            className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 font-medium text-brand-700 hover:bg-brand-50"
          >
            <Plus className="size-5" aria-hidden /> Add a unit
          </button>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Select label="Drivers count it in" value={form.count_unit} onChange={set('count_unit')}>
              <option value="">{form.base_unit}</option>
              {unitNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <Select label="You buy it by the" value={form.purchase_unit} onChange={set('purchase_unit')}>
              <option value="">{countName}</option>
              {unitNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <Toggle
              label="Whole numbers only"
              hint="Turn on for things counted whole, like cups. Off lets drivers count ¼, ½, ¾."
              checked={form.whole_only}
              onChange={(v) => setForm({ ...form, whole_only: v })}
            />
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="font-semibold sm:col-span-2">Cost and ordering</h3>
          <div className="flex items-end gap-2">
            <Field label="Cost ($)" inputMode="decimal" value={form.cost} onChange={set('cost')} className="flex-1" />
            <Select label="per" value={form.cost_unit} onChange={set('cost_unit')} className="w-36">
              <option value="">{form.base_unit}</option>
              {unitNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <Select label="Supplier" value={form.supplier_id} onChange={set('supplier_id')}>
            <option value="">None</option>
            {(suppliers.data ?? [])
              .filter((s) => s.active || s.id === form.supplier_id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
          <Field
            label={`Reorder when the warehouse has (${countName})`}
            inputMode="decimal"
            value={form.reorder_level}
            onChange={set('reorder_level')}
            hint="Low stock alerts and order lists start here."
          />
          <Field
            label={`Order up to (${countName})`}
            inputMode="decimal"
            value={form.order_up_to}
            onChange={set('order_up_to')}
            hint="Orders fill back up to this amount."
          />
          {num(form.cost) !== null && form.cost_unit !== form.count_unit && factorOf(form.cost_unit) > 0 && (
            <p className="text-sm text-slate-500 sm:col-span-2">
              That's {formatMoney((num(form.cost)! / factorOf(form.cost_unit)) * factorOf(form.count_unit))} per {countName}.
            </p>
          )}
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="font-semibold sm:col-span-2">Where it's used</h3>
          <Select label="Truck type" value={form.truck_type_id} onChange={set('truck_type_id')}>
            <option value="">All trucks</option>
            {(types.data ?? [])
              .filter((t) => t.active || t.id === form.truck_type_id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </Select>
          <Select
            label="Group"
            hint="For flavors guests pick themselves. Usage is compared on the group total."
            value={form.group_id}
            onChange={set('group_id')}
          >
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id} disabled={g.base_unit.toLowerCase() !== form.base_unit.trim().toLowerCase()}>
                {g.name} ({g.base_unit})
              </option>
            ))}
          </Select>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">Tracking</h3>
          <Toggle
            label="Track expiration dates"
            hint="Asks for a date when it's delivered, warns before it expires, and uses the oldest first."
            checked={form.tracks_expiration}
            onChange={(v) => setForm({ ...form, tracks_expiration: v })}
          />
          {form.tracks_expiration && (
            <Field
              label="Usual shelf life (days)"
              inputMode="numeric"
              value={form.shelf_life_days}
              onChange={set('shelf_life_days')}
              hint="Fills in the expiration date on deliveries. It can be changed each time."
            />
          )}
          <Toggle
            label="Manager count check"
            hint={
              settings.data?.count_checks_enabled
                ? 'A manager recounts this after each shift, and their count wins.'
                : 'Turn on manager count checks in Business settings to use this.'
            }
            checked={form.count_check}
            onChange={(v) => setForm({ ...form, count_check: v })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Flag when off by more than (%)"
              inputMode="decimal"
              placeholder={settings.data ? `Business default: ${settings.data.diff_percent}%` : ''}
              value={form.diff_percent}
              onChange={set('diff_percent')}
            />
            <Field
              label={`and more than (${countName})`}
              inputMode="decimal"
              placeholder={settings.data ? `Default: worth $${settings.data.diff_min_dollars}` : ''}
              value={form.diff_min_qty}
              onChange={set('diff_min_qty')}
            />
          </div>
        </section>

        <TextArea label="Notes" value={form.notes} onChange={set('notes')} />

        <EditorActions
          isNew={!supply}
          active={supply?.active ?? true}
          saving={save.busy}
          onToggleActive={() => void toggle.run()}
          onDelete={() => void remove.run()}
          deleting={remove.busy}
        />
      </form>
    </Sheet>
  )
}
