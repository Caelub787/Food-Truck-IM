import { describe, expect, it } from 'vitest'
import { call, shiftSetup } from './fixtures'
import { addMember, as, createCompany, sql } from './helpers'

const at = (days: number, hour: number) => {
  const d = new Date(Date.UTC(2026, 10, 2 + days, hour))
  return d.toISOString()
}

describe('scheduling', () => {
  it('managers plan shifts, repeat them weekly, and cancel later ones', async () => {
    const s = await shiftSetup()
    const [r] = await call(s.manager, 'save_schedule', {
      truck_id: s.truck,
      starts_at: at(0, 15),
      ends_at: at(0, 22),
      event_name: 'Farmers market',
      lead_id: s.lead.id,
      crew_ids: [s.crew.id, s.lead.id],
      repeat_weeks: 3,
    })
    const first = r!.r as string
    const plans = await sql(`select id, starts_at, series_id from public.schedules where company_id = $1 order by starts_at`, [s.c.id])
    expect(plans).toHaveLength(4)
    expect(new Set(plans.map((p) => p.series_id)).size).toBe(1)
    expect(await sql(`select user_id from public.schedule_crew where schedule_id = $1`, [first])).toEqual([{ user_id: s.crew.id }])

    // Cancel the second week and everything after it.
    await as(s.manager, (q) => q(`select public.cancel_schedule($1, true)`, [plans[1]!.id]))
    const status = await sql(`select status from public.schedules where company_id = $1 order by starts_at`, [s.c.id])
    expect(status.map((x) => x.status)).toEqual(['planned', 'cancelled', 'cancelled', 'cancelled'])

    // Edit one: new crew.
    const other = await addMember(s.c.id, 'driver')
    await call(s.manager, 'save_schedule', { id: first, truck_id: s.truck, starts_at: at(0, 16), ends_at: at(0, 22), lead_id: s.lead.id, crew_ids: [other.id] })
    expect(await sql(`select user_id from public.schedule_crew where schedule_id = $1`, [first])).toEqual([{ user_id: other.id }])
  })

  it('drivers see only plans they are on, and can not change them', async () => {
    const s = await shiftSetup()
    await call(s.manager, 'save_schedule', { truck_id: s.truck, starts_at: at(1, 15), ends_at: at(1, 20), lead_id: s.lead.id })
    await call(s.manager, 'save_schedule', { truck_id: s.truck, starts_at: at(2, 15), ends_at: at(2, 20), lead_id: s.crew.id })
    expect(await as(s.lead, (q) => q(`select starts_at from public.schedules`))).toHaveLength(1)
    await expect(call(s.lead, 'save_schedule', { truck_id: s.truck, starts_at: at(3, 15), ends_at: at(3, 20) })).rejects.toThrow(/permission/)
    const other = await createCompany()
    expect(await as(other.admin, (q) => q(`select 1 from public.schedules where company_id = $1`, [s.c.id]))).toEqual([])
    await expect(call(other.admin, 'save_schedule', { truck_id: s.truck, starts_at: at(3, 15), ends_at: at(3, 20) })).rejects.toThrow(/Pick a truck/)
    await expect(
      call(s.manager, 'save_schedule', { truck_id: s.truck, starts_at: at(3, 15), ends_at: at(3, 20), lead_id: other.admin.id }),
    ).rejects.toThrow(/someone in your business/)
    await expect(call(s.manager, 'save_schedule', { truck_id: s.truck, starts_at: at(3, 20), ends_at: at(3, 15) })).rejects.toThrow(/after the start/)
  })

  it('a shift can start from a plan', async () => {
    const s = await shiftSetup()
    const [r] = await call(s.manager, 'save_schedule', { truck_id: s.truck, starts_at: at(0, 15), ends_at: at(0, 20), lead_id: s.lead.id })
    const shift = await s.start(s.lead, { schedule_id: r!.r })
    expect((await sql(`select schedule_id from public.shifts where id = $1`, [shift]))[0]?.schedule_id).toBe(r!.r)
  })
})
