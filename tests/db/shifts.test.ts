import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { call, insertAs, level, shiftSetup, stockSetup, type Json } from './fixtures'
import { addMember, as, createCompany, sql, type User } from './helpers'

const result = async (shift: string, key: { supply?: string; group?: string }) =>
  (
    await sql(
      `select start_qty::float as start, added_qty::float as added, end_qty::float as "end", waste_qty::float as waste, actual_qty::float as actual
       from public.shift_results where shift_id = $1 and supply_id is not distinct from $2 and group_id is not distinct from $3`,
      [shift, key.supply ?? null, key.group ?? null],
    )
  )[0]

describe('a whole shift', () => {
  it('counts, loads, wastes, returns, and finishes with the right usage', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    const crew = await sql(`select user_id, role from public.shift_crew where shift_id = $1 order by role desc`, [shift])
    expect(crew).toEqual([
      { user_id: s.lead.id, role: 'lead' },
      { user_id: s.crew.id, role: 'crew' },
    ])

    // Crew counts. Ice is 5 short. Syrups aren't counted, so they're taken as expected.
    await s.counts(s.crew, shift, 'start', [
      [s.cups, 100],
      [s.ice, 45],
    ])
    await expect(s.fn(s.crew, 'confirm_shift_start', shift)).rejects.toThrow(/Only the Lead/)
    await expect(call(s.lead, 'load_truck', { shift_id: shift, lines: [] })).rejects.toThrow(/starting count/)
    await s.fn(s.lead, 'confirm_shift_start', shift)
    expect(await level(s.truck, s.ice)).toBe(45)
    const [flag] = await sql(`select kind, details from public.flags where shift_id = $1`, [shift])
    expect(flag?.kind).toBe('start_mismatch')
    expect(flag?.details).toMatch(/Ice/)
    expect(flag?.details).not.toMatch(/Cups/)
    const [cherryStart] = await sql(`select quantity::float as q from public.shift_counts where shift_id = $1 and supply_id = $2 and kind = 'start'`, [
      shift,
      s.cherry,
    ])
    expect(cherryStart?.q).toBe(128)

    // Load from the warehouse, waste some, and send some ice back early.
    await call(s.lead, 'load_truck', {
      shift_id: shift,
      lines: [
        { supply_id: s.cups, quantity: 50 },
        { supply_id: s.ice, quantity: 20 },
      ],
    })
    expect(await level(s.warehouse, s.cups)).toBe(850)
    expect(await level(s.truck, s.cups)).toBe(150)
    await call(s.crew, 'log_waste', { shift_id: shift, supply_id: s.cups, quantity: 2 })
    await call(s.crew, 'log_waste', { shift_id: shift, product_size_id: s.small, quantity: 1 })
    expect(await level(s.truck, s.cups)).toBe(147)
    expect(await level(s.truck, s.ice)).toBe(64.5)
    const lines = await sql(`select supply_id, group_id, quantity::float as q from public.waste_lines where company_id = $1 and group_id is not null`, [
      s.c.id,
    ])
    expect(lines).toEqual([{ supply_id: null, group_id: s.group, q: 2 }])
    await call(s.crew, 'return_from_truck', { shift_id: shift, lines: [{ supply_id: s.ice, quantity: 10 }] })

    // Ending count. Everything has to be counted.
    await s.counts(s.crew, shift, 'end', [
      [s.cups, 120],
      [s.ice, 40],
      [s.cherry, 100],
    ])
    await expect(s.fn(s.lead, 'confirm_shift_end', shift)).rejects.toThrow(/Still need: Blue/)
    await s.counts(s.crew, shift, 'end', [[s.blue, 60]])
    await s.fn(s.lead, 'confirm_shift_end', shift)
    await expect(call(s.crew, 'log_waste', { shift_id: shift, supply_id: s.cups, quantity: 1 })).rejects.toThrow(/ending count is done/)

    // Returns after the ending count don't change usage.
    await call(s.crew, 'return_from_truck', { shift_id: shift, lines: [{ supply_id: s.cups, quantity: 20 }] })
    await expect(s.fn(s.crew, 'finish_shift', shift, null)).rejects.toThrow(/Only the Lead/)
    await s.fn(s.lead, 'finish_shift', shift, null)

    expect(await result(shift, { supply: s.cups })).toEqual({ start: 100, added: 50, end: 120, waste: 3, actual: 27 })
    expect(await result(shift, { supply: s.ice })).toEqual({ start: 45, added: 10, end: 40, waste: 0.5, actual: 14.5 })
    expect(await result(shift, { supply: s.cherry })).toEqual({ start: 128, added: 0, end: 100, waste: 0, actual: 28 })
    // The group: 32 oz gone, 2 of it wasted in a drink.
    expect(await result(shift, { group: s.group })).toEqual({ start: 192, added: 0, end: 160, waste: 2, actual: 30 })

    // The truck now holds what was counted, less what went back after.
    expect(await level(s.truck, s.cups)).toBe(100)
    expect(await level(s.truck, s.ice)).toBe(40)
    expect(await level(s.truck, s.blue)).toBe(60)
    const [usage] = await sql(`select quantity::float as q from public.stock_movements where shift_id = $1 and kind = 'usage' and supply_id = $2`, [
      shift,
      s.cups,
    ])
    expect(usage?.q).toBe(27)
    const [closed] = await sql(`select status, count_check_status from public.shifts where id = $1`, [shift])
    expect(closed).toEqual({ status: 'closed', count_check_status: 'not_needed' })
    await expect(s.counts(s.lead, shift, 'end', [[s.cups, 1]])).rejects.toThrow(/already finished/)
  })

  it('handles more left than the app expected', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    await s.fn(s.lead, 'confirm_shift_start', shift)
    await s.counts(s.lead, shift, 'end', [
      [s.cups, 105],
      [s.ice, 50],
      [s.cherry, 128],
      [s.blue, 64],
    ])
    await s.fn(s.lead, 'confirm_shift_end', shift)
    await s.fn(s.lead, 'finish_shift', shift, null)
    expect((await result(shift, { supply: s.cups }))?.actual).toBe(-5)
    expect(await level(s.truck, s.cups)).toBe(105)
  })

  it('counts stock moved onto the truck by a manager during the shift', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    await s.fn(s.lead, 'confirm_shift_start', shift)
    await call(s.manager, 'transfer_stock', { from_place_id: s.warehouse, to_place_id: s.truck, lines: [{ supply_id: s.cups, quantity: 30 }] })
    await call(s.manager, 'log_waste', { place_id: s.truck, supply_id: s.ice, quantity: 1 })
    await s.counts(s.lead, shift, 'end', [
      [s.cups, 110],
      [s.ice, 49],
      [s.cherry, 128],
      [s.blue, 64],
    ])
    await s.fn(s.lead, 'confirm_shift_end', shift)
    await s.fn(s.lead, 'finish_shift', shift, null)
    expect(await result(shift, { supply: s.cups })).toMatchObject({ added: 30, actual: 20 })
    expect(await result(shift, { supply: s.ice })).toMatchObject({ waste: 1, actual: 0 })
    expect(await level(s.truck, s.cups)).toBe(110)
  })

  it('the latest change wins when two phones count the same thing', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    const at = (ms: number) => new Date(Date.now() + ms).toISOString()
    await call(s.crew, 'save_shift_counts', { shift_id: shift, kind: 'start', lines: [{ supply_id: s.cups, quantity: 90, client_ts: at(1000) }] })
    // This one was typed earlier but arrived late (the phone was offline).
    await call(s.lead, 'save_shift_counts', { shift_id: shift, kind: 'start', lines: [{ supply_id: s.cups, quantity: 80, client_ts: at(0) }] })
    const [row] = await sql(`select quantity::float as q from public.shift_counts where shift_id = $1 and supply_id = $2`, [shift, s.cups])
    expect(row?.q).toBe(90)
  })

  it('does things once even when a phone sends them twice', async () => {
    const s = await shiftSetup()
    const id = randomUUID()
    const first = await s.start(s.lead, { client_id: id })
    const again = await s.start(s.lead, { client_id: id })
    expect(again).toBe(first)
    await s.fn(s.lead, 'confirm_shift_start', first)
    const load = { shift_id: first, client_id: randomUUID(), lines: [{ supply_id: s.cups, quantity: 10 }] }
    await call(s.lead, 'load_truck', load)
    await call(s.lead, 'load_truck', load)
    expect(await level(s.truck, s.cups)).toBe(110)
    const waste = { shift_id: first, client_id: randomUUID(), supply_id: s.cups, quantity: 1 }
    await call(s.lead, 'log_waste', waste)
    await call(s.lead, 'log_waste', waste)
    expect(await sql(`select count(*)::int as n from public.waste_logs where shift_id = $1`, [first])).toEqual([{ n: 1 }])
  })

  it('can be cancelled only before it starts', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    await s.fn(s.lead, 'cancel_shift', shift)
    expect((await sql(`select status from public.shifts where id = $1`, [shift]))[0]?.status).toBe('cancelled')
    const next = await s.start()
    await s.fn(s.lead, 'confirm_shift_start', next)
    await expect(s.fn(s.lead, 'cancel_shift', next)).rejects.toThrow(/already started/)
  })
})

describe('who can work a shift', () => {
  it('one shift per truck, and others can see it and join', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    const other = await addMember(s.c.id, 'driver')
    await expect(s.start(other, { crew_ids: [] })).rejects.toThrow(/already has a shift going/)
    const open = await as(other, (q) => q(`select shift_id, lead_id from public.open_shifts()`))
    expect(open).toEqual([{ shift_id: shift, lead_id: s.lead.id }])
    expect(await as(other, (q) => q(`select id from public.shifts`))).toEqual([])
    await s.fn(other, 'join_shift', shift)
    expect(await as(other, (q) => q(`select id from public.shifts`))).toEqual([{ id: shift }])
  })

  it('a manager can start a shift for drivers without being on it', async () => {
    const s = await shiftSetup()
    const shift = await s.start(s.manager, { lead_id: s.lead.id })
    const crew = await sql(`select user_id from public.shift_crew where shift_id = $1`, [shift])
    expect(crew.map((r) => r.user_id).sort()).toEqual([s.lead.id, s.crew.id].sort())
    // The Lead can hand the lead to someone else.
    await as(s.lead, (q) => q(`select public.set_shift_crew($1, $2, $3)`, [shift, s.crew.id, [s.lead.id]]))
    const [row] = await sql(`select lead_id from public.shifts where id = $1`, [shift])
    expect(row?.lead_id).toBe(s.crew.id)
    await expect(s.fn(s.lead, 'confirm_shift_start', shift)).rejects.toThrow(/Only the Lead/)
  })

  it('drivers only see shifts they work, and nobody sees another business', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    await s.counts(s.lead, shift, 'start', [[s.cups, 100]])
    await s.fn(s.lead, 'confirm_shift_start', shift)
    await call(s.lead, 'load_truck', { shift_id: shift, lines: [{ supply_id: s.cups, quantity: 5 }] })
    await call(s.lead, 'log_waste', { shift_id: shift, supply_id: s.cups, quantity: 1 })

    const outsider = await addMember(s.c.id, 'driver')
    const other = await createCompany()
    const otherManager = await addMember(other.id, 'manager')
    const tables = ['shifts', 'shift_crew', 'shift_counts', 'waste_logs', 'waste_lines', 'stock_movements']
    for (const who of [outsider, other.admin, otherManager]) {
      for (const t of tables) {
        const rows = await as(who, (q) => q(`select 1 from public.${t} where company_id = $1`, [s.c.id]))
        expect(rows, `${t} should be hidden`).toEqual([])
      }
    }
    // The Lead sees their shift and its moves, but not the warehouse deliveries.
    const moves = await as(s.lead, (q) => q<{ kind: string }>(`select kind from public.stock_movements`))
    expect(moves.map((m) => m.kind).sort()).toEqual(['load', 'waste'])
    expect(await as(s.manager, (q) => q(`select id from public.shifts`))).toEqual([{ id: shift }])

    // Nobody outside the shift can change it.
    for (const who of [outsider, other.admin]) {
      await expect(s.counts(who, shift, 'end', [[s.cups, 1]])).rejects.toThrow(/not on this shift|not found/)
      await expect(call(who, 'load_truck', { shift_id: shift, lines: [{ supply_id: s.cups, quantity: 1 }] })).rejects.toThrow(
        /not on this shift|not found/,
      )
      await expect(call(who, 'log_waste', { shift_id: shift, supply_id: s.cups, quantity: 1 })).rejects.toThrow(/not on this shift|not found/)
      await expect(s.fn(who, 'finish_shift', shift, null)).rejects.toThrow(/not on this shift|not found/)
    }
    await expect(s.start(other.admin, { crew_ids: [] })).rejects.toThrow(/Pick a truck/)
    // Can't put people from another business on a shift.
    await expect(s.start(s.manager, { truck_id: s.truck, lead_id: other.admin.id })).rejects.toThrow()
  })
})

describe('waste', () => {
  it('drivers only log waste on their shift, and only with their own things', async () => {
    const s = await shiftSetup()
    await expect(call(s.lead, 'log_waste', { place_id: s.warehouse, supply_id: s.cups, quantity: 1 })).rejects.toThrow(/from their shift/)
    const shift = await s.start()
    await expect(call(s.lead, 'log_waste', { shift_id: shift, supply_id: s.cups, quantity: 1 })).rejects.toThrow(/starting count/)
    await s.fn(s.lead, 'confirm_shift_start', shift)
    const other = await stockSetup()
    const theirs = await other.supply('Their cups')
    await expect(call(s.lead, 'log_waste', { shift_id: shift, supply_id: theirs, quantity: 1 })).rejects.toThrow(/not found/)
    await expect(
      call(s.lead, 'log_waste', { shift_id: shift, supply_id: s.cups, quantity: 1, photo_path: `${other.c.id}/waste/x.jpg` }),
    ).rejects.toThrow(/photo was not found/)
    await expect(call(s.lead, 'log_waste', { shift_id: shift, supply_id: s.cups, quantity: 0 })).rejects.toThrow(/how much/)
  })

  it('managers log warehouse waste, with its cost', async () => {
    const s = await shiftSetup()
    const [reason] = await sql<{ id: string }>(`select id from public.waste_reasons where company_id = $1 limit 1`, [s.c.id])
    await call(s.manager, 'log_waste', { place_id: s.warehouse, supply_id: s.ice, quantity: 10, reason_id: reason!.id, note: 'Bag tore' })
    expect(await level(s.warehouse, s.ice)).toBe(940)
    const [log] = await sql(`select cost::float, shift_id from public.waste_logs where company_id = $1`, [s.c.id])
    expect(log).toEqual({ cost: 3, shift_id: null })
  })
})

describe('flags, par levels, and photos', () => {
  it('only managers see flags, and they can mark them reviewed', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    await s.counts(s.lead, shift, 'start', [[s.cups, 1]])
    await s.fn(s.lead, 'confirm_shift_start', shift)
    expect(await as(s.lead, (q) => q(`select id from public.flags`))).toEqual([])
    const [flag] = await as(s.manager, (q) => q<{ id: string }>(`select id from public.flags`))
    const other = await createCompany()
    await expect(s.fn(other.admin, 'review_flag', flag!.id, null)).rejects.toThrow(/not found/)
    await expect(s.fn(s.lead, 'review_flag', flag!.id, null)).rejects.toThrow(/permission/)
    await s.fn(s.manager, 'review_flag', flag!.id, 'Talked to the driver')
    expect((await sql(`select status from public.flags where id = $1`, [flag!.id]))[0]?.status).toBe('reviewed')
  })

  it('par levels: managers set them, drivers read them, other businesses see nothing', async () => {
    const s = await shiftSetup()
    await insertAs(s.manager, 'truck_pars', { truck_id: s.truck, supply_id: s.cups, par_quantity: 200 })
    await expect(insertAs(s.lead, 'truck_pars', { truck_id: s.truck, supply_id: s.ice, par_quantity: 1 })).rejects.toThrow(
      /row.level security|permission denied/,
    )
    expect(await as(s.lead, (q) => q(`select par_quantity::float as p from public.truck_pars`))).toEqual([{ p: 200 }])
    const other = await createCompany()
    expect(await as(other.admin, (q) => q(`select 1 from public.truck_pars where company_id = $1`, [s.c.id]))).toEqual([])
    await expect(insertAs(other.admin, 'truck_pars', { truck_id: s.truck, supply_id: s.cups, par_quantity: 1 })).rejects.toThrow()
  })

  it('photos stay inside their business', async () => {
    const s = await shiftSetup()
    const other = await createCompany()
    const put = (who: User, name: string) => as(who, (q) => q(`insert into storage.objects (bucket_id, name) values ('photos', $1)`, [name]))
    await put(s.lead, `${s.c.id}/waste/a.jpg`)
    await expect(put(s.lead, `${other.id}/waste/b.jpg`)).rejects.toThrow(/row.level security/)
    expect(await as(other.admin, (q) => q(`select name from storage.objects`))).toEqual([])
    expect(await as(s.crew, (q) => q(`select name from storage.objects`))).toEqual([{ name: `${s.c.id}/waste/a.jpg` }])
    await as(s.lead, (q) => q(`delete from storage.objects`))
    expect(await sql(`select count(*)::int as n from storage.objects where name like $1`, [`${s.c.id}/%`])).toEqual([{ n: 1 }])
    await as(s.manager, (q) => q(`delete from storage.objects`))
    expect(await sql(`select count(*)::int as n from storage.objects where name like $1`, [`${s.c.id}/%`])).toEqual([{ n: 0 }])
  })

  it('shift changes are sent live to the business', async () => {
    const s = await shiftSetup()
    await s.start()
    const sent = await sql(`select payload from realtime.messages where topic = $1 and event = 'change'`, [`company:${s.c.id}`])
    const tables = sent.map((m) => (m.payload as Json).table)
    expect(tables).toContain('shifts')
    expect(tables).toContain('shift_crew')
  })
})
