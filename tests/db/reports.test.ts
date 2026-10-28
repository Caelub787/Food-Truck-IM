import { describe, expect, it } from 'vitest'
import { call, level, runShift, shiftSetup, type ShiftSetup } from './fixtures'
import { as, createCompany, sql } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Report = Record<string, any>

const usedSome = (s: ShiftSetup): [string, number][] => [
  [s.cups, 80],
  [s.ice, 40],
  [s.cherry, 100],
  [s.blue, 60],
]
const report = (who: ShiftSetup['manager'], truck: string | null = null) =>
  as(who, (q) =>
    q<{ r: Report }>(`select public.report(now() - interval '1 day', now() + interval '1 day', $1) as r`, [truck]),
  ).then((rows) => rows[0]!.r)

describe('reports', () => {
  it('adds up shifts, sales, free drinks, waste, and drivers', async () => {
    const s = await shiftSetup()
    await sql(`update public.product_sizes set price = 4 where id = $1`, [s.small])
    const [reason] = await sql<{ id: string }>(`select id from public.free_reasons where company_id = $1 limit 1`, [s.c.id])
    const shift = await s.start()
    await s.fn(s.lead, 'confirm_shift_start', shift)
    await call(s.lead, 'save_sales_tally', {
      shift_id: shift,
      lines: [
        { key: 'paid', product_size_id: s.small, quantity: 8 },
        { key: 'free', product_size_id: s.small, quantity: 2, is_free: true, free_reason_id: reason!.id },
      ],
    })
    await call(s.lead, 'log_waste', { shift_id: shift, supply_id: s.ice, quantity: 2 })
    await s.counts(s.lead, shift, 'end', usedSome(s).map(([id, q]) => [id, id === s.ice ? 38 : q]))
    await s.fn(s.lead, 'confirm_shift_end', shift)
    await s.fn(s.lead, 'finish_shift', shift, null)

    const r = await report(s.manager)
    expect(r.totals).toMatchObject({ shifts: 1, drinks: 10, free: 2, revenue: 32, shift_waste: 0.6 })
    // 20 cups at 0.1, 10 lb ice at 0.3, 32 oz syrup at 0.1
    expect(r.totals.used).toBeCloseTo(8.2)
    // Free drinks: 2 × (1 cup + 0.5 lb ice + 2 oz syrup) = 2 × (0.1 + 0.15 + 0.2)
    expect(r.free_reasons).toEqual([{ reason_id: reason!.id, drinks: 2, cost: 0.9 }])
    expect(r.drivers).toEqual([expect.objectContaining({ user_id: s.lead.id, shifts: 1, drinks: 10 })])
    expect(r.waste_supplies).toEqual([{ supply_id: s.ice, quantity: 2, cost: 0.6 }])
    expect(r.shifts[0]).toMatchObject({ id: shift, source: 'driver' })

    // Another truck's filter shows nothing.
    const other = await as(s.c.admin, (q) => q<{ id: string }>(`insert into public.trucks (name) values ('Truck 9') returning id`))
    expect((await report(s.manager, other[0]!.id)).totals.shifts).toBe(0)
  })

  it('only managers see reports, and only their own business', async () => {
    const s = await shiftSetup()
    await runShift(s, usedSome(s))
    await expect(report(s.lead)).rejects.toThrow(/permission/)
    const other = await createCompany()
    expect((await report(other.admin)).totals.shifts).toBe(0)
  })
})

describe('corrections', () => {
  it('fixes a count on a finished shift, keeps the history, and fixes the truck', async () => {
    const s = await shiftSetup()
    const shift = await runShift(s, usedSome(s))
    expect(await level(s.truck, s.cups)).toBe(80)
    await expect(call(s.manager, 'correct_shift_count', { shift_id: shift, supply_id: s.cups, kind: 'end', quantity: 70, reason: '' })).rejects.toThrow(
      /Say why/,
    )
    await expect(
      call(s.lead, 'correct_shift_count', { shift_id: shift, supply_id: s.cups, kind: 'end', quantity: 70, reason: 'Recounted' }),
    ).rejects.toThrow(/permission/)
    await call(s.manager, 'correct_shift_count', { shift_id: shift, supply_id: s.cups, kind: 'end', quantity: 70, reason: 'Missed a sleeve under the seat' })

    const [res] = await sql(`select end_qty::float as e, actual_qty::float as a from public.shift_results where shift_id = $1 and supply_id = $2`, [
      shift,
      s.cups,
    ])
    expect(res).toEqual({ e: 70, a: 30 })
    expect(await level(s.truck, s.cups)).toBe(70)
    const [log] = await sql(`select action, reason, old_data, new_data from public.audit_log where row_id = $1 and action = 'correct'`, [shift])
    expect(log).toMatchObject({ action: 'correct', reason: 'Missed a sleeve under the seat' })
    expect((log?.old_data as Record<string, unknown>).quantity).toBe(80)

    // Once the truck has gone out again, its stock is left alone.
    await s.start()
    await call(s.manager, 'correct_shift_count', { shift_id: shift, supply_id: s.cups, kind: 'end', quantity: 75, reason: 'Recounted again' })
    expect(await level(s.truck, s.cups)).toBe(70)
  })

  it("can't fix another business's shift", async () => {
    const s = await shiftSetup()
    const shift = await runShift(s, usedSome(s))
    const other = await shiftSetup()
    await expect(
      call(other.manager, 'correct_shift_count', { shift_id: shift, supply_id: s.cups, kind: 'end', quantity: 1, reason: 'x' }),
    ).rejects.toThrow(/not found/)
  })
})
