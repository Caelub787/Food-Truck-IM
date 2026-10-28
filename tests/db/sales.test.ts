import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { call, insertAs, level, runShift, shiftSetup, type Json, type ShiftSetup } from './fixtures'
import { addMember, as, createCompany, sql } from './helpers'

// The truck starts with 100 cups, 50 lb ice, 128 oz cherry, and 64 oz blue.
// This shift uses 20 cups, 10 lb ice, and 32 oz of syrup.
const usedSome = (s: ShiftSetup): [string, number][] => [
  [s.cups, 80],
  [s.ice, 40],
  [s.cherry, 100],
  [s.blue, 60],
]

const tally = (s: ShiftSetup, who = s.lead, shift: string, quantity: number, extra: Json = {}) =>
  call(who, 'save_sales_tally', {
    shift_id: shift,
    lines: [{ key: `small${extra.is_free ? '-free' : ''}`, product_size_id: s.small, quantity, client_ts: new Date().toISOString(), ...extra }],
  })

const results = async (shift: string) =>
  sql(
    `select coalesce(sp.name, g.name) as name, r.expected_qty::float as expected, r.diff_qty::float as diff, r.flagged
     from public.shift_results r left join public.supplies sp on sp.id = r.supply_id left join public.supply_groups g on g.id = r.group_id
     where r.shift_id = $1 order by 1`,
    [shift],
  )
const flag = async (shift: string, kind: string) =>
  (await sql(`select title, details, status from public.flags where shift_id = $1 and kind = $2`, [shift, kind]))[0]
const lowLimits = (s: ShiftSetup) => sql(`update public.company_settings set diff_min_dollars = 0.5 where company_id = $1`, [s.c.id])

describe('expected vs actual', () => {
  it('compares what was used with what sales say, by supply and by group', async () => {
    const s = await shiftSetup()
    await lowLimits(s)
    const shift = await s.start()
    await s.fn(s.lead, 'confirm_shift_start', shift)
    await tally(s, s.lead, shift, 10)
    await s.counts(s.lead, shift, 'end', usedSome(s))
    await s.fn(s.lead, 'confirm_shift_end', shift)
    await s.fn(s.lead, 'finish_shift', shift, null)

    // 10 drinks: 10 cups, 5 lb ice, 20 oz syrup. Syrups are compared as a group.
    expect(await results(shift)).toEqual([
      { name: 'Blue', expected: null, diff: null, flagged: false },
      { name: 'Cherry', expected: null, diff: null, flagged: false },
      { name: 'Cups', expected: 10, diff: 10, flagged: true },
      { name: 'Ice', expected: 5, diff: 5, flagged: true },
      { name: 'Syrups', expected: 20, diff: 12, flagged: true },
    ])
    const f = await flag(shift, 'usage_diff')
    expect(f?.details).toMatch(/Cups: used 10 more than sales show \(100%\)/)
    expect(f?.details).toMatch(/Syrups: used 12 oz more/)

    // A manager enters their own tally later. Managers beat drivers, so it's compared again.
    await tally(s, s.manager, shift, 20)
    expect((await results(shift)).find((r) => r.name === 'Cups')).toEqual({ name: 'Cups', expected: 20, diff: 0, flagged: false })
    expect((await flag(shift, 'usage_diff'))?.details).toMatch(/Syrups: used 8 oz less/)
    expect((await flag(shift, 'sales_mismatch'))?.details).toMatch(/Manager: 20 drinks \(0 free\)\. Driver: 10 drinks/)
  })

  it('skips the comparison when a shift has no sales', async () => {
    const s = await shiftSetup()
    const shift = await runShift(s, usedSome(s))
    expect((await results(shift)).every((r) => r.expected === null)).toBe(true)
    expect(await flag(shift, 'usage_diff')).toBeUndefined()
  })

  it('flags a shift that is off by more than the dollar limit', async () => {
    const s = await shiftSetup()
    await sql(`update public.company_settings set shift_dollar_limit = 1 where company_id = $1`, [s.c.id])
    const shift = await s.start()
    await s.fn(s.lead, 'confirm_shift_start', shift)
    await tally(s, s.lead, shift, 1)
    await s.counts(s.lead, shift, 'end', usedSome(s))
    await s.fn(s.lead, 'confirm_shift_end', shift)
    await s.fn(s.lead, 'finish_shift', shift, null)
    expect((await flag(shift, 'shift_cost'))?.title).toMatch(/is off by \$/)
  })
})

describe('tallies', () => {
  it('free drinks bring in nothing, paid ones use the price, and the latest change wins', async () => {
    const s = await shiftSetup()
    await sql(`update public.product_sizes set price = 4 where id = $1`, [s.small])
    const [reason] = await sql<{ id: string }>(`select id from public.free_reasons where company_id = $1 limit 1`, [s.c.id])
    const shift = await s.start()
    await tally(s, s.lead, shift, 3)
    await tally(s, s.crew, shift, 2, { is_free: true, free_reason_id: reason!.id })
    const rows = await sql(`select quantity::float as q, price::float, is_free, source from public.sales where shift_id = $1 order by is_free`, [shift])
    expect(rows).toEqual([
      { q: 3, price: 12, is_free: false, source: 'driver' },
      { q: 2, price: 0, is_free: true, source: 'driver' },
    ])
    // An older change from a phone that was offline doesn't win.
    await call(s.lead, 'save_sales_tally', {
      shift_id: shift,
      lines: [{ key: 'small', product_size_id: s.small, quantity: 99, client_ts: new Date(Date.now() - 60_000).toISOString() }],
    })
    expect((await sql(`select quantity::float as q from public.sales where shift_id = $1 and not is_free`, [shift]))[0]?.q).toBe(3)
    await tally(s, s.lead, shift, 0)
    expect(await sql(`select 1 from public.sales where shift_id = $1 and not is_free`, [shift])).toEqual([])
  })

  it('only the people the business picked can enter sales', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    await sql(`update public.company_settings set sales_reporters = 'managers' where company_id = $1`, [s.c.id])
    await expect(tally(s, s.lead, shift, 1)).rejects.toThrow(/managers report sales/)
    await tally(s, s.manager, shift, 1)
    const outsider = await addMember(s.c.id, 'driver')
    await sql(`update public.company_settings set sales_reporters = 'both' where company_id = $1`, [s.c.id])
    await expect(tally(s, outsider, shift, 1)).rejects.toThrow(/not on this shift/)
    const other = await createCompany()
    await expect(tally(s, other.admin, shift, 1)).rejects.toThrow(/not found/)
    // Drivers can't change sales after the shift is finished.
    await s.fn(s.lead, 'confirm_shift_start', shift)
    await s.counts(s.lead, shift, 'end', usedSome(s))
    await s.fn(s.lead, 'confirm_shift_end', shift)
    await s.fn(s.lead, 'finish_shift', shift, null)
    await expect(tally(s, s.lead, shift, 5)).rejects.toThrow(/already finished/)
  })
})

describe('sales files', () => {
  const upload = (s: ShiftSetup, p: Json, who = s.manager) => call(who, 'ingest_sales', p).then((r) => r[0]!.r as Json)

  it('matches items once, remembers them, never counts a sale twice, and can be undone', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    const now = new Date().toISOString()
    const rows = [
      { ref: 'A1', sold_at: now, item_key: 'Small Shaved Ice', item_name: 'Small Shaved Ice', modifier_keys: ['Extra syrup'], quantity: 2, price: 8 },
      { ref: 'A2', sold_at: now, item_key: 'tip', item_name: 'Tip', quantity: 1, price: 1 },
      { ref: 'A3', sold_at: now, item_key: 'mystery', item_name: 'Mystery', quantity: 1, price: 3 },
    ]
    const first = await upload(s, {
      import_id: randomUUID(),
      file_name: 'oct.csv',
      truck_id: s.truck,
      mappings: [
        { kind: 'item', outside_key: 'small shaved ice', product_size_id: s.small },
        { kind: 'item', outside_key: 'tip', ignore: true },
        { kind: 'modifier', outside_key: 'extra syrup', ignore: true },
      ],
      rows,
    })
    expect(first).toMatchObject({ added: 1, duplicates: 0, ignored: 1, unmatched: 1, no_shift: 0, unmatched_names: ['Mystery'] })
    const [sale] = await sql(`select shift_id, quantity::float as q, price::float, modifier_ids from public.sales where source_ref = 'A1'`)
    expect(sale).toEqual({ shift_id: shift, q: 2, price: 8, modifier_ids: [] })

    // The same file again: nothing new, and the matches were remembered.
    const again = await upload(s, { import_id: randomUUID(), truck_id: s.truck, rows })
    expect(again).toMatchObject({ added: 0, duplicates: 1, ignored: 1, unmatched: 1 })

    // A sale from days ago isn't on any shift, so it's flagged.
    const old = await upload(s, {
      import_id: randomUUID(),
      truck_id: s.truck,
      rows: [{ ref: 'B1', sold_local: '2026-01-05 13:30', item_key: 'small shaved ice', quantity: 1 }],
    })
    expect(old).toMatchObject({ added: 1, no_shift: 1 })
    const [b1] = await sql(`select shift_id, sold_at from public.sales where source_ref = 'B1'`)
    expect(b1?.shift_id).toBeNull()
    expect(await sql(`select 1 from public.flags where company_id = $1 and kind = 'sales_no_shift'`, [s.c.id])).toHaveLength(1)

    await as(s.manager, (q) => q(`select public.undo_sales_import($1)`, [first.import_id]))
    expect(await sql(`select 1 from public.sales where source_ref = 'A1'`)).toEqual([])
    await expect(as(s.manager, (q) => q(`select public.undo_sales_import($1)`, [first.import_id]))).rejects.toThrow(/already undone/)
  })

  it('reads local times in the business time zone and finds trucks by name', async () => {
    const s = await shiftSetup()
    await sql(`update public.companies set timezone = 'America/New_York' where id = $1`, [s.c.id])
    const r = await upload(s, {
      import_id: randomUUID(),
      mappings: [
        { kind: 'item', outside_key: 'small', product_size_id: s.small },
        { kind: 'truck', outside_key: 'Kona 1', truck_id: s.truck },
      ],
      rows: [{ ref: 'T1', sold_local: '2026-07-04 12:00', truck_key: 'KONA 1', item_key: 'small' }],
    })
    expect(r).toMatchObject({ added: 1 })
    const [row] = await sql(`select truck_id, sold_at from public.sales where source_ref = 'T1' and company_id = $1`, [s.c.id])
    expect(row?.truck_id).toBe(s.truck)
    expect((row?.sold_at as Date).toISOString()).toBe('2026-07-04T16:00:00.000Z')
  })

  it('the file wins over driver tallies', async () => {
    const s = await shiftSetup()
    await lowLimits(s)
    const shift = await s.start()
    await s.fn(s.lead, 'confirm_shift_start', shift)
    await tally(s, s.lead, shift, 5)
    await upload(s, {
      import_id: randomUUID(),
      truck_id: s.truck,
      mappings: [{ kind: 'item', outside_key: 'small', product_size_id: s.small }],
      rows: [{ ref: 'F1', sold_at: new Date().toISOString(), item_key: 'small', quantity: 20 }],
    })
    await s.counts(s.lead, shift, 'end', usedSome(s))
    await s.fn(s.lead, 'confirm_shift_end', shift)
    await s.fn(s.lead, 'finish_shift', shift, null)
    expect((await results(shift)).find((r) => r.name === 'Cups')?.expected).toBe(20)
    expect((await flag(shift, 'sales_mismatch'))?.details).toMatch(/Sales file: 20 drinks \(0 free\)\. Driver: 5 drinks/)
  })

  it('only managers upload, and only with their own things', async () => {
    const s = await shiftSetup()
    await expect(upload(s, { rows: [] }, s.lead)).rejects.toThrow(/permission/)
    const other = await shiftSetup()
    await expect(
      upload(s, { mappings: [{ kind: 'item', outside_key: 'x', product_size_id: other.small }], rows: [] }),
    ).rejects.toThrow(/foreign key/)
    await expect(upload(s, { truck_id: other.truck, rows: [{ ref: 'X', sold_at: new Date().toISOString(), item_key: 'x' }] })).resolves.toMatchObject({
      added: 0,
      unmatched: 1,
    })
    const [imp] = await sql<{ id: string }>(`select id from public.sales_imports where company_id = $1 limit 1`, [s.c.id])
    await expect(as(other.manager, (q) => q(`select public.undo_sales_import($1)`, [imp!.id]))).rejects.toThrow(/not found/)
  })

  it('sales, matches, and uploads stay inside their business', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    await tally(s, s.lead, shift, 2)
    await insertAs(s.manager, 'item_mappings', { source: 'csv', kind: 'item', outside_key: 'lg', product_size_id: s.small })
    await insertAs(s.manager, 'sales_file_formats', { headers_key: 'date,item', columns: { item: 1 } })
    const other = await createCompany()
    const outsider = await addMember(s.c.id, 'driver')
    for (const who of [other.admin, outsider]) {
      for (const t of ['sales', 'item_mappings', 'sales_file_formats', 'sales_imports']) {
        expect(await as(who, (q) => q(`select 1 from public.${t} where company_id = $1`, [s.c.id])), t).toEqual([])
      }
    }
    // Drivers see the sales on their own shift, but can't change matches.
    expect(await as(s.lead, (q) => q(`select quantity::float as q from public.sales`))).toEqual([{ q: 2 }])
    await expect(insertAs(s.lead, 'item_mappings', { source: 'csv', kind: 'item', outside_key: 'x', ignore: true })).rejects.toThrow(
      /row.level security|permission denied/,
    )
    const sent = await sql(`select payload from realtime.messages where topic = $1 and event = 'change'`, [`company:${s.c.id}`])
    expect(sent.map((m) => (m.payload as Json).table)).toContain('sales')
  })
})

describe('manager count checks', () => {
  const check = (s: ShiftSetup, shift: string, cups: number) =>
    call(s.manager, 'record_count_check', { shift_id: shift, lines: [{ supply_id: s.cups, quantity: cups }] })

  it("waits for a manager, and the manager's count wins and fixes the truck", async () => {
    const s = await shiftSetup()
    await sql(`update public.company_settings set count_checks_enabled = true where company_id = $1`, [s.c.id])
    await sql(`update public.supplies set count_check = true where id = $1`, [s.cups])
    const shift = await runShift(s, usedSome(s))
    expect((await sql(`select count_check_status from public.shifts where id = $1`, [shift]))[0]?.count_check_status).toBe('waiting')
    expect(await level(s.truck, s.cups)).toBe(80)

    await expect(check({ ...s, manager: s.lead }, shift, 75)).rejects.toThrow(/permission/)
    await check(s, shift, 75)
    const [cups] = await sql(`select end_qty::float as e, actual_qty::float as a from public.shift_results where shift_id = $1 and supply_id = $2`, [
      shift,
      s.cups,
    ])
    expect(cups).toEqual({ e: 75, a: 25 })
    expect(await level(s.truck, s.cups)).toBe(75)
    expect((await flag(shift, 'count_check'))?.details).toBe('Cups: driver counted 80, manager counted 75.')
    expect((await sql(`select count_check_status from public.shifts where id = $1`, [shift]))[0]?.count_check_status).toBe('done')

    // Fixing a typo in the check moves the truck by just the difference.
    await check(s, shift, 80)
    expect(await level(s.truck, s.cups)).toBe(80)
    expect(await flag(shift, 'count_check')).toBeUndefined()
  })

  it("is missed once the truck goes out again, and the driver's count stays when the business says so", async () => {
    const s = await shiftSetup()
    await sql(`update public.company_settings set count_checks_enabled = true, count_check_manager_wins = false where company_id = $1`, [s.c.id])
    await sql(`update public.supplies set count_check = true where id = $1`, [s.cups])
    const shift = await runShift(s, usedSome(s))
    await check(s, shift, 70)
    expect(await level(s.truck, s.cups)).toBe(80)
    expect((await flag(shift, 'count_check'))?.details).toMatch(/manager counted 70/)

    const next = await runShift(s, usedSome(s))
    await s.start()
    expect((await sql(`select count_check_status from public.shifts where id = $1`, [next]))[0]?.count_check_status).toBe('missed')
    expect((await flag(next, 'count_check_missed'))?.title).toMatch(/Count check missed/)
    await expect(check(s, next, 80)).rejects.toThrow(/too late/)
  })
})
