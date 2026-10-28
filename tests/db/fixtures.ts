import { addMember, as, createCompany, sql, type Company, type User } from './helpers'

export type Json = Record<string, unknown>

/** A business with its warehouse, one truck, and a way to add supplies. */
export async function stockSetup(company?: Company) {
  const c = company ?? (await createCompany())
  const [warehouse] = await sql<{ id: string }>(`select id from public.locations where company_id = $1`, [c.id])
  const [truck] = await as(c.admin, (q) => q<{ id: string }>(`insert into public.trucks (name) values ('Truck 1') returning id`))
  const supply = async (name: string, extra: Json = {}) => {
    const [{ id }] = (await as(c.admin, (q) =>
      q(`select public.save_supply($1) as id`, [JSON.stringify({ name, base_unit: 'oz', cost_per_base: 0.05, ...extra })]),
    )) as [{ id: string }]
    return id
  }
  return { c, warehouse: warehouse!.id, truck: truck!.id, supply }
}

export const level = async (place: string, supply: string) =>
  Number((await sql(`select quantity from public.stock_levels where place_id = $1 and supply_id = $2`, [place, supply]))[0]?.quantity ?? 0)

export const call = (who: User, fn: string, p: Json) => as(who, (q) => q(`select public.${fn}($1) as r`, [JSON.stringify(p)]))


export type Row = { id: string } & Json

/** Adds a row as a person, through the normal security rules. */
export async function insertAs<T extends Json = Row>(who: User, table: string, row: Json): Promise<T> {
  const cols = Object.keys(row)
  const [created] = await as(who, (q) =>
    q<T>(
      `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
      Object.values(row),
    ),
  )
  return created!
}

/** A business with stock on a truck, a Lead, a crew member, and a drink with a recipe. */
export async function shiftSetup() {
  const base = await stockSetup()
  const { c, warehouse, truck, supply } = base
  const lead = await addMember(c.id, 'driver')
  const crew = await addMember(c.id, 'driver')
  const manager = await addMember(c.id, 'manager')
  const cups = await supply('Cups', { base_unit: 'each', cost_per_base: 0.1 })
  const ice = await supply('Ice', { base_unit: 'lb', cost_per_base: 0.3 })
  const group = await insertAs(c.admin, 'supply_groups', { name: 'Syrups', base_unit: 'oz' })
  const cherry = await supply('Cherry', { group_id: group.id, cost_per_base: 0.1 })
  const blue = await supply('Blue', { group_id: group.id, cost_per_base: 0.1 })
  await call(c.admin, 'receive_delivery', {
    location_id: warehouse,
    lines: [cups, ice, cherry, blue].map((id) => ({ supply_id: id, quantity: 1000 })),
  })
  await call(c.admin, 'transfer_stock', {
    from_place_id: warehouse,
    to_place_id: truck,
    lines: [
      { supply_id: cups, quantity: 100 },
      { supply_id: ice, quantity: 50 },
      { supply_id: cherry, quantity: 128 },
      { supply_id: blue, quantity: 64 },
    ],
  })
  const product = await insertAs(c.admin, 'products', { name: 'Shaved ice' })
  const small = await insertAs(c.admin, 'product_sizes', { product_id: product.id, name: 'Small' })
  await as(c.admin, (q) =>
    q(`select public.save_recipe($1, $2)`, [
      small.id,
      JSON.stringify([
        { supply_id: cups, quantity: 1 },
        { supply_id: ice, quantity: 0.5 },
        { group_id: group.id, quantity: 2 },
      ]),
    ]),
  )
  const start = async (who: User = lead, extra: Json = {}) =>
    (await call(who, 'start_shift', { truck_id: truck, crew_ids: [crew.id], ...extra }))[0]!.r as string
  const fn = (who: User, name: string, ...args: unknown[]) =>
    as(who, (q) => q(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args))
  const counts = (who: User, shift: string, kind: 'start' | 'end', lines: [string, number | null][]) =>
    call(who, 'save_shift_counts', { shift_id: shift, kind, lines: lines.map(([supply_id, quantity]) => ({ supply_id, quantity })) })
  return { ...base, lead, crew, manager, cups, ice, group: group.id, cherry, blue, small: small.id, start, fn, counts }
}

export type ShiftSetup = Awaited<ReturnType<typeof shiftSetup>>

/** Runs a whole shift with no changes along the way and the given ending counts. Returns its id. */
export async function runShift(s: ShiftSetup, end: [string, number][]) {
  const shift = await s.start()
  await s.fn(s.lead, 'confirm_shift_start', shift)
  await s.counts(s.lead, shift, 'end', end)
  await s.fn(s.lead, 'confirm_shift_end', shift)
  await s.fn(s.lead, 'finish_shift', shift, null)
  return shift
}
