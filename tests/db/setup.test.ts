import { describe, expect, it } from 'vitest'
import { addMember, as, createCompany, sql, type User } from './helpers'

type Json = Record<string, unknown>
type Row = { id: string } & Json

async function insertAs<T extends Json = Row>(who: User, table: string, row: Json): Promise<T> {
  const cols = Object.keys(row)
  const [created] = await as(who, (q) =>
    q<T>(
      `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
      Object.values(row),
    ),
  )
  return created!
}

describe('new business defaults', () => {
  it('starts every business with settings, lists, and a warehouse', async () => {
    const c = await createCompany()
    const [settings] = await sql(`select diff_percent, sales_reporters from public.company_settings where company_id = $1`, [c.id])
    expect(settings).toMatchObject({ sales_reporters: 'drivers' })
    const counts = await sql(
      `select (select count(*)::int from public.waste_reasons where company_id = $1) as waste,
              (select count(*)::int from public.free_reasons where company_id = $1) as free,
              (select count(*)::int from public.checklist_items where company_id = $1) as checklist,
              (select count(*)::int from public.locations where company_id = $1) as locations`,
      [c.id],
    )
    expect(counts[0]).toMatchObject({ waste: 7, free: 4, checklist: 5, locations: 1 })
  })
})

describe('setup tables are separated by business and role', () => {
  const tables: { table: string; row: (c: string) => Json; writers: string[]; driverCanRead: boolean }[] = [
    { table: 'trucks', row: () => ({ name: `Truck ${Math.random()}` }), writers: ['admin', 'manager'], driverCanRead: true },
    { table: 'locations', row: () => ({ name: `Spot ${Math.random()}` }), writers: ['admin'], driverCanRead: true },
    { table: 'suppliers', row: () => ({ name: `Sup ${Math.random()}` }), writers: ['admin', 'manager'], driverCanRead: false },
    { table: 'supplies', row: () => ({ name: `Cups ${Math.random()}` }), writers: ['admin', 'manager'], driverCanRead: true },
    { table: 'products', row: () => ({ name: `Latte ${Math.random()}` }), writers: ['admin', 'manager'], driverCanRead: true },
    { table: 'waste_reasons', row: () => ({ name: `Lost ${Math.random()}` }), writers: ['admin', 'manager'], driverCanRead: true },
  ]

  for (const t of tables) {
    it(`${t.table}: only the right roles write, nobody sees another business`, async () => {
      const a = await createCompany()
      const b = await createCompany()
      const manager = await addMember(a.id, 'manager')
      const driver = await addMember(a.id, 'driver')
      const people: Record<string, User> = { admin: a.admin, manager, driver }

      for (const [role, who] of Object.entries(people)) {
        const attempt = insertAs(who, t.table, t.row(a.id))
        if (t.writers.includes(role)) await expect(attempt).resolves.toMatchObject({ company_id: a.id })
        else await expect(attempt).rejects.toThrow(/row.level security|permission denied/)
      }

      const bRow = await insertAs(b.admin, t.table, t.row(b.id))
      for (const who of Object.values(people)) {
        const seen = await as(who, (q) => q(`select id from public.${t.table} where id = $1`, [bRow.id]))
        expect(seen).toEqual([])
        await as(who, (q) => q(`update public.${t.table} set name = 'Hacked' where id = $1`, [bRow.id]))
        await as(who, (q) => q(`delete from public.${t.table} where id = $1`, [bRow.id]))
      }
      const [still] = await sql(`select name from public.${t.table} where id = $1`, [bRow.id])
      expect(still?.name).not.toBe('Hacked')

      const driverRows = as(driver, (q) => q(`select id from public.${t.table}`))
      if (t.driverCanRead) await expect(driverRows).resolves.toBeDefined()
      else expect(await driverRows).toEqual([])
    })
  }

  it("can't point a row at another business's row", async () => {
    const a = await createCompany()
    const b = await createCompany()
    const bType = await insertAs(b.admin, 'truck_types', { name: 'Coffee' })
    await expect(insertAs(a.admin, 'trucks', { name: 'Sneaky', truck_type_id: bType.id })).rejects.toThrow(/foreign key/)
  })

  it('only admins change business settings', async () => {
    const c = await createCompany()
    const manager = await addMember(c.id, 'manager')
    await as(manager, (q) => q(`update public.company_settings set diff_percent = 50`))
    await as(c.admin, (q) => q(`update public.company_settings set diff_percent = 15, scheduling_enabled = true`))
    const [row] = await sql(`select diff_percent, scheduling_enabled from public.company_settings where company_id = $1`, [c.id])
    expect(row).toMatchObject({ diff_percent: '15', scheduling_enabled: true })
  })

  it('changes to setup data are logged and sent live', async () => {
    const c = await createCompany()
    const truck = await insertAs(c.admin, 'trucks', { name: 'Truck 1' })
    const audit = await sql(`select action from public.audit_log where table_name = 'trucks' and row_id = $1`, [truck.id])
    expect(audit).toEqual([{ action: 'insert' }])
    const live = await sql(`select payload from realtime.messages where topic = $1 order by id desc limit 1`, [`company:${c.id}`])
    expect(live[0]?.payload).toEqual({ table: 'trucks', op: 'insert' })
  })
})

describe('places', () => {
  it('every truck and location is a place, and unused ones can be deleted', async () => {
    const c = await createCompany()
    const truck = await insertAs(c.admin, 'trucks', { name: 'Truck X' })
    expect(await sql(`select kind from public.places where id = $1`, [truck.id])).toEqual([{ kind: 'truck' }])
    await as(c.admin, (q) => q(`delete from public.trucks where id = $1`, [truck.id]))
    expect(await sql(`select 1 from public.places where id = $1`, [truck.id])).toEqual([])
  })
})

describe('supplies and units', () => {
  it('keeps group members on the same base unit', async () => {
    const c = await createCompany()
    const group = await insertAs(c.admin, 'supply_groups', { name: 'Syrups', base_unit: 'oz' })
    await expect(insertAs(c.admin, 'supplies', { name: 'Cherry', base_unit: 'lb', group_id: group.id })).rejects.toThrow(
      /base unit \(oz\)/,
    )
    await expect(insertAs(c.admin, 'supplies', { name: 'Cherry', base_unit: 'oz', group_id: group.id })).resolves.toBeDefined()
  })

  it("won't use another supply's unit as a count unit", async () => {
    const c = await createCompany()
    const milk = await insertAs(c.admin, 'supplies', { name: 'Milk', base_unit: 'oz' })
    const cups = await insertAs(c.admin, 'supplies', { name: 'Cups' })
    const jug = await insertAs(c.admin, 'supply_units', { supply_id: milk.id, name: 'half gallon', factor: 64 })
    await expect(
      as(c.admin, (q) => q(`update public.supplies set count_unit_id = $1 where id = $2`, [jug.id, cups.id])),
    ).rejects.toThrow(/foreign key/)
  })
})

async function latteSetup() {
  const c = await createCompany()
  const milk = await insertAs(c.admin, 'supplies', { name: 'Whole milk', base_unit: 'oz' })
  const oat = await insertAs(c.admin, 'supplies', { name: 'Oat milk', base_unit: 'oz' })
  const beans = await insertAs(c.admin, 'supplies', { name: 'Espresso beans', base_unit: 'g' })
  const cup = await insertAs(c.admin, 'supplies', { name: 'Large cup' })
  const latte = await insertAs(c.admin, 'products', { name: 'Latte' })
  const large = await insertAs(c.admin, 'product_sizes', { product_id: latte.id, name: 'Large' })
  const small = await insertAs(c.admin, 'product_sizes', { product_id: latte.id, name: 'Small' })
  const group = await insertAs(c.admin, 'modifier_groups', { name: 'Milk' })
  const oatMod = await insertAs(c.admin, 'modifiers', { group_id: group.id, name: 'Oat milk' })
  const extras = await insertAs(c.admin, 'modifier_groups', { name: 'Extras' })
  const shot = await insertAs(c.admin, 'modifiers', { group_id: extras.id, name: 'Extra shot' })
  return { c, milk, oat, beans, cup, latte, large, small, oatMod, shot }
}

describe('recipes', () => {
  it('makes a new version only when the recipe changes', async () => {
    const { c, milk, cup, large } = await latteSetup()
    const lines = [
      { supply_id: milk.id, quantity: 10 },
      { supply_id: cup.id, quantity: 1 },
    ]
    const [first] = await as(c.admin, (q) => q(`select public.save_recipe($1, $2) as v`, [large.id, JSON.stringify(lines)]))
    const [same] = await as(c.admin, (q) => q(`select public.save_recipe($1, $2) as v`, [large.id, JSON.stringify([...lines].reverse())]))
    expect(same?.v).toBe(first?.v)
    const [changed] = await as(c.admin, (q) =>
      q(`select public.save_recipe($1, $2) as v`, [large.id, JSON.stringify([{ supply_id: milk.id, quantity: 12 }, lines[1]])]),
    )
    expect(changed?.v).not.toBe(first?.v)
    expect(await sql(`select count(*)::int as n from public.recipe_versions where product_size_id = $1`, [large.id])).toEqual([{ n: 2 }])
  })

  it('old sales use the old recipe', async () => {
    const { c, milk, large } = await latteSetup()
    await as(c.admin, (q) => q(`select public.save_recipe($1, $2)`, [large.id, JSON.stringify([{ supply_id: milk.id, quantity: 10 }])]))
    await sql(`update public.recipe_versions set effective_from = now() - interval '10 days' where product_size_id = $1`, [large.id])
    await as(c.admin, (q) => q(`select public.save_recipe($1, $2)`, [large.id, JSON.stringify([{ supply_id: milk.id, quantity: 12 }])]))

    const usage = async (at: string) =>
      (await sql(`select quantity from app.usage_for_sale($1, '{}', $2)`, [large.id, at]))[0]?.quantity
    expect(await usage(new Date(Date.now() - 5 * 86400_000).toISOString())).toBe('10')
    expect(await usage(new Date().toISOString())).toBe('12')
    // Sales from before any recipe existed use the first one.
    expect(await usage(new Date(Date.now() - 100 * 86400_000).toISOString())).toBe('10')
  })

  it('applies add ons: swaps, adds, and size specific amounts', async () => {
    const { c, milk, oat, beans, cup, large, small, oatMod, shot } = await latteSetup()
    for (const [size, ml] of [
      [large, 10],
      [small, 6],
    ] as const) {
      await as(c.admin, (q) =>
        q(`select public.save_recipe($1, $2)`, [
          size.id,
          JSON.stringify([
            { supply_id: milk.id, quantity: ml },
            { supply_id: beans.id, quantity: 18 },
            { supply_id: cup.id, quantity: 1 },
          ]),
        ]),
      )
    }
    await as(c.admin, (q) =>
      q(`select public.save_modifier_effects($1, $2)`, [oatMod.id, JSON.stringify([{ kind: 'swap', supply_id: milk.id, to_supply_id: oat.id }])]),
    )
    await as(c.admin, (q) =>
      q(`select public.save_modifier_effects($1, $2)`, [
        shot.id,
        JSON.stringify([
          { kind: 'add', supply_id: beans.id, quantity: 9 },
          { kind: 'add', size_name: 'large', supply_id: beans.id, quantity: 2 },
        ]),
      ]),
    )

    const usage = async (sizeId: string, mods: string[]) =>
      Object.fromEntries(
        (await sql<{ supply_id: string; quantity: string }>(`select supply_id, quantity from app.usage_for_sale($1, $2, now())`, [sizeId, mods])).map(
          (r) => [r.supply_id, Number(r.quantity)],
        ),
      )
    expect(await usage(large.id, [oatMod.id, shot.id])).toEqual({ [oat.id]: 10, [beans.id]: 29, [cup.id]: 1 })
    expect(await usage(small.id, [shot.id])).toEqual({ [milk.id]: 6, [beans.id]: 27, [cup.id]: 1 })
  })

  it('drivers and other businesses cannot save recipes', async () => {
    const { c, milk, large } = await latteSetup()
    const driver = await addMember(c.id, 'driver')
    const other = await createCompany()
    const call = (who: User) =>
      as(who, (q) => q(`select public.save_recipe($1, $2)`, [large.id, JSON.stringify([{ supply_id: milk.id, quantity: 1 }])]))
    await expect(call(driver)).rejects.toThrow(/permission/)
    await expect(call(other.admin)).rejects.toThrow(/not found/)
  })
})

describe('spreadsheet import', () => {
  it('imports supplies with units, costs, levels, suppliers, and groups', async () => {
    const c = await createCompany()
    const rows = [
      {
        name: 'Whole milk', category: 'Dairy', base_unit: 'oz', count_unit: 'half gallon', count_unit_size: '64',
        purchase_unit: 'case', purchase_unit_size: '6', cost: '$19.20', reorder_level: '4', order_up_to: '12',
        supplier: 'Dairy Co', supplier_email: 'orders@dairy.example', tracks_expiration: 'yes', shelf_life_days: '10',
      },
      { name: 'Cherry syrup', base_unit: 'oz', count_unit: 'gallon', count_unit_size: '128', group: 'Syrups', cost: '24', cost_per: 'count' },
      { name: '', base_unit: 'oz' },
      { name: 'Bad', count_unit: 'box', count_unit_size: '0' },
    ]
    const [{ r }] = (await as(c.admin, (q) => q(`select public.import_supplies($1) as r`, [JSON.stringify(rows)]))) as [{ r: Json }]
    expect(r).toMatchObject({ created: 2, updated: 0 })
    expect((r.errors as Json[]).map((e) => e.row)).toEqual([3, 4])

    const [milk] = await sql(
      `select s.cost_per_base::float as cost, s.reorder_level::float as reorder, s.order_up_to::float as upto,
              s.tracks_expiration, cu.name as count_unit, pu.factor::float as case_size, sup.email
       from public.supplies s
       join public.supply_units cu on cu.id = s.count_unit_id
       join public.supply_units pu on pu.id = s.purchase_unit_id
       join public.suppliers sup on sup.id = s.supplier_id
       where s.company_id = $1 and s.name = 'Whole milk'`,
      [c.id],
    )
    expect(milk).toMatchObject({ cost: 0.05, reorder: 256, upto: 768, tracks_expiration: true, count_unit: 'half gallon', case_size: 384, email: 'orders@dairy.example' })
    const [cherry] = await sql(`select s.cost_per_base::float as cost, g.name as grp from public.supplies s join public.supply_groups g on g.id = s.group_id where s.company_id = $1 and s.name = 'Cherry syrup'`, [c.id])
    expect(cherry).toMatchObject({ cost: 0.1875, grp: 'Syrups' })

    // Importing again updates instead of copying.
    const [{ again }] = (await as(c.admin, (q) => q(`select public.import_supplies($1) as again`, [JSON.stringify([{ name: 'whole MILK', cost: '20' }])]))) as [{ again: Json }]
    expect(again).toMatchObject({ created: 0, updated: 1 })
  })

  it('imports products with sizes and recipes', async () => {
    const c = await createCompany()
    await as(c.admin, (q) =>
      q(`select public.import_supplies($1)`, [
        JSON.stringify([
          { name: 'Whole milk', base_unit: 'oz', count_unit: 'half gallon', count_unit_size: '64' },
          { name: 'Espresso beans', base_unit: 'g', count_unit: 'shot', count_unit_size: '9' },
          { name: 'Large cup' },
        ]),
      ]),
    )
    const rows = [
      { product: 'Latte', size: 'Large', price: '5.50', supply: 'Whole milk', amount: '10', unit: 'oz' },
      { product: 'Latte', size: 'Large', supply: 'Espresso beans', amount: '2', unit: 'shot' },
      { product: 'Latte', size: 'Large', supply: 'Large cup', amount: '1' },
      { product: 'Latte', size: 'Small', price: '4.50' },
      { product: 'Mocha', size: 'Large', supply: 'Chocolate', amount: '1' },
    ]
    const [{ r }] = (await as(c.admin, (q) => q(`select public.import_products($1) as r`, [JSON.stringify(rows)]))) as [{ r: Json }]
    expect(r).toMatchObject({ created: 2 })
    expect((r.errors as Json[]).map((e) => e.row)).toEqual([5])

    const lines = await sql<{ name: string; quantity: string }>(
      `select s.name, l.quantity from public.recipe_lines l join public.supplies s on s.id = l.supply_id
       join public.recipe_versions v on v.id = l.recipe_version_id
       join public.product_sizes ps on ps.id = v.product_size_id
       where ps.company_id = $1 and ps.name = 'Large' order by s.name`,
      [c.id],
    )
    expect(lines.map((l) => [l.name, Number(l.quantity)])).toEqual([
      ['Espresso beans', 18],
      ['Large cup', 1],
      ['Whole milk', 10],
    ])
    const sizes = await sql(`select name, price::float as price from public.product_sizes where company_id = $1 order by name`, [c.id])
    expect(sizes).toEqual([
      { name: 'Large', price: 5.5 },
      { name: 'Large', price: null },
      { name: 'Small', price: 4.5 },
    ])
  })

  it('drivers cannot import', async () => {
    const c = await createCompany()
    const driver = await addMember(c.id, 'driver')
    await expect(as(driver, (q) => q(`select public.import_supplies('[]')`))).rejects.toThrow(/permission/)
  })
})

describe('saving a supply', () => {
  it('saves the supply and its units together, and edits them later', async () => {
    const c = await createCompany()
    const save = (p: Json) => as(c.admin, (q) => q<{ id: string }>(`select public.save_supply($1) as id`, [JSON.stringify(p)]))
    const [{ id }] = (await save({
      name: 'Whole milk', base_unit: 'oz', cost_per_base: 0.05, reorder_level: 256,
      units: [{ name: 'half gallon', factor: 64 }, { name: 'case', factor: 384 }],
      count_unit: 'half gallon', purchase_unit: 'case',
    })) as [{ id: string }]
    const units = await sql(`select id, name from public.supply_units where supply_id = $1 order by factor`, [id])
    const [row] = await sql(`select cu.name as count_unit, pu.name as purchase_unit from public.supplies s
      left join public.supply_units cu on cu.id = s.count_unit_id left join public.supply_units pu on pu.id = s.purchase_unit_id where s.id = $1`, [id])
    expect(row).toEqual({ count_unit: 'half gallon', purchase_unit: 'case' })

    // Rename one unit, drop the other.
    await save({ id, name: 'Whole milk', base_unit: 'oz', units: [{ id: units[0]!.id, name: 'jug', factor: 64 }], count_unit: 'jug' })
    expect(await sql(`select name from public.supply_units where supply_id = $1`, [id])).toEqual([{ name: 'jug' }])
  })

  it('drivers and other businesses cannot save supplies', async () => {
    const a = await createCompany()
    const b = await createCompany()
    const driver = await addMember(a.id, 'driver')
    const [{ id }] = (await as(a.admin, (q) => q(`select public.save_supply($1) as id`, [JSON.stringify({ name: 'Cups' })]))) as [{ id: string }]
    await expect(as(driver, (q) => q(`select public.save_supply($1)`, [JSON.stringify({ name: 'X' })]))).rejects.toThrow(/permission/)
    await expect(as(b.admin, (q) => q(`select public.save_supply($1)`, [JSON.stringify({ id, name: 'Hacked' })]))).rejects.toThrow(/not found/)
  })
})
