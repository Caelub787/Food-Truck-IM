import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { call, insertAs, runShift, shiftSetup, type ShiftSetup } from './fixtures'
import { addMember, as, createCompany, sql } from './helpers'

const outbox = (company: string, template: string) =>
  sql<{ to_user: string | null; to_email: string | null; payload: Record<string, unknown>; channel: string }>(
    `select to_user, to_email, payload, channel from public.outbox where company_id = $1 and template = $2 order by created_at`,
    [company, template],
  )
const flags = (company: string, kind: string) =>
  sql<{ title: string; details: string; status: string }>(`select title, details, status from public.flags where company_id = $1 and kind = $2`, [company, kind])
const job = (fn: string, ...args: unknown[]) => sql(`select app.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)

// The warehouse has 900 cups after 100 went on the truck.
const cupsLow = (s: ShiftSetup, extra = '') =>
  sql(`update public.supplies set reorder_level = 950 ${extra} where id = $1`, [s.cups])

describe('low stock', () => {
  it('flags low stock once, tells managers, and clears when restocked', async () => {
    const s = await shiftSetup()
    await cupsLow(s)
    await job('job_low_stock', s.c.id)
    await job('job_low_stock', s.c.id)
    expect(await flags(s.c.id, 'low_stock')).toEqual([{ title: 'Low on Cups', details: '900 left. Reorder at 950.', status: 'open' }])
    const pushes = await outbox(s.c.id, 'push')
    expect(pushes.map((p) => p.to_user).sort()).toEqual([s.c.admin.id, s.manager.id].sort())

    await call(s.c.admin, 'receive_delivery', { location_id: s.warehouse, lines: [{ supply_id: s.cups, quantity: 100 }] })
    await job('job_low_stock', s.c.id)
    expect(await flags(s.c.id, 'low_stock')).toEqual([])
  })

  it('people can turn alerts off for themselves only', async () => {
    const s = await shiftSetup()
    await insertAs(s.manager, 'notification_settings', { user_id: s.manager.id, alert_push: false })
    await expect(insertAs(s.manager, 'notification_settings', { user_id: s.lead.id, alert_push: true })).rejects.toThrow(/row.level security/)
    await cupsLow(s)
    await job('job_low_stock', s.c.id)
    expect((await outbox(s.c.id, 'push')).map((p) => p.to_user)).toEqual([s.c.admin.id])
  })
})

describe('supplier orders', () => {
  it('makes an order list, waits for a manager, then emails the supplier', async () => {
    const s = await shiftSetup()
    const supplier = await insertAs(s.manager, 'suppliers', { name: 'Paper Co', order_method: 'email', email: 'orders@paper.test' })
    await cupsLow(s, `, order_up_to = 2000, supplier_id = '${supplier.id}'`)
    await job('job_orders', s.c.id)
    const [order] = await sql<{ id: string; status: string }>(`select id, status from public.purchase_orders where supplier_id = $1`, [supplier.id])
    expect(order?.status).toBe('draft')
    expect(await sql(`select quantity::float as q from public.purchase_order_lines where order_id = $1`, [order!.id])).toEqual([{ q: 1100 }])
    expect(await outbox(s.c.id, 'supplier_order')).toEqual([])

    await expect(as(s.lead, (q) => q(`select public.approve_purchase_order($1)`, [order!.id]))).rejects.toThrow(/permission/)
    const other = await createCompany()
    await expect(as(other.admin, (q) => q(`select public.approve_purchase_order($1)`, [order!.id]))).rejects.toThrow(/not found/)
    expect(await as(other.admin, (q) => q(`select 1 from public.purchase_orders where company_id = $1`, [s.c.id]))).toEqual([])

    const [r] = await as(s.manager, (q) => q<{ r: string }>(`select public.approve_purchase_order($1) as r`, [order!.id]))
    expect(r?.r).toBe('sent')
    const [mail] = await outbox(s.c.id, 'supplier_order')
    expect(mail?.to_email).toBe('orders@paper.test')
    expect(mail?.payload.lines).toEqual([{ name: 'Cups', amount: '1100' }])

    // Still low, but it's already on order, so no new list.
    await job('job_orders', s.c.id)
    expect(await sql(`select status from public.purchase_orders where supplier_id = $1`, [supplier.id])).toEqual([{ status: 'sent' }])

    await call(s.manager, 'receive_delivery', {
      location_id: s.warehouse,
      supplier_id: supplier.id,
      purchase_order_id: order!.id,
      lines: [{ supply_id: s.cups, quantity: 1100 }],
    })
    expect((await sql(`select status from public.purchase_orders where id = $1`, [order!.id]))[0]?.status).toBe('received')
  })

  it("leaves a list alone once a manager changes it", async () => {
    const s = await shiftSetup()
    const supplier = await insertAs(s.manager, 'suppliers', { name: 'Paper Co' })
    await cupsLow(s, `, supplier_id = '${supplier.id}'`)
    await job('job_orders', s.c.id)
    const [order] = await sql<{ id: string }>(`select id from public.purchase_orders where supplier_id = $1`, [supplier.id])
    await call(s.manager, 'save_purchase_order', { order_id: order!.id, lines: [{ supply_id: s.cups, quantity: 50 }] })
    await as(s.manager, (q) => q(`select public.build_order_lists()`))
    await expect(as(s.lead, (q) => q(`select public.build_order_lists()`))).rejects.toThrow(/permission/)
    expect(await sql(`select quantity::float as q from public.purchase_order_lines where order_id = $1`, [order!.id])).toEqual([{ q: 50 }])
    // Self ordered suppliers just get marked approved.
    const [r] = await as(s.manager, (q) => q<{ r: string }>(`select public.approve_purchase_order($1) as r`, [order!.id]))
    expect(r?.r).toBe('approved')
  })
})

describe('reminders and expiration', () => {
  it('reminds the Lead about a shift left open, then alerts managers', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    await sql(`update public.shifts set started_at = now() - interval '20 hours' where id = $1`, [shift])
    await job('job_reminders', s.c.id, new Date().toISOString())
    expect((await outbox(s.c.id, 'push')).filter((p) => p.to_user === s.lead.id)).toHaveLength(1)
    expect(await flags(s.c.id, 'open_too_long')).toHaveLength(1)
    await s.fn(s.lead, 'cancel_shift', shift)
    await job('job_reminders', s.c.id, new Date().toISOString())
    expect(await flags(s.c.id, 'open_too_long')).toEqual([])
  })

  it('reminds people when a planned shift has not started', async () => {
    const s = await shiftSetup()
    await sql(`update public.company_settings set scheduling_enabled = true where company_id = $1`, [s.c.id])
    const start = new Date(Date.now() - 3600_000).toISOString()
    const end = new Date(Date.now() + 3 * 3600_000).toISOString()
    await call(s.manager, 'save_schedule', { truck_id: s.truck, starts_at: start, ends_at: end, lead_id: s.lead.id, crew_ids: [s.crew.id] })
    await job('job_reminders', s.c.id, new Date().toISOString())
    const pushes = (await outbox(s.c.id, 'push')).filter((p) => String(p.payload.title).startsWith('Time to start'))
    expect(pushes.map((p) => p.to_user).sort()).toEqual([s.lead.id, s.crew.id].sort())
    expect(await flags(s.c.id, 'not_started')).toHaveLength(1)
    await s.start()
    await job('job_reminders', s.c.id, new Date().toISOString())
    expect(await flags(s.c.id, 'not_started')).toEqual([])
  })

  it('warns before things expire and when expired stock is still around', async () => {
    const s = await shiftSetup()
    const milk = await s.supply('Milk', { tracks_expiration: true })
    const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
    await call(s.c.admin, 'receive_delivery', {
      location_id: s.warehouse,
      lines: [
        { supply_id: milk, quantity: 64, expires_on: day(-1) },
        { supply_id: milk, quantity: 64, expires_on: day(2) },
        { supply_id: milk, quantity: 64, expires_on: day(20) },
      ],
    })
    await job('job_expiration', s.c.id, day(0))
    expect(await flags(s.c.id, 'expired')).toHaveLength(1)
    expect(await flags(s.c.id, 'expiring')).toHaveLength(1)
    // Throwing out the expired milk clears its flag (oldest goes first).
    await call(s.manager, 'log_waste', { place_id: s.warehouse, supply_id: milk, quantity: 64 })
    await job('job_expiration', s.c.id, day(0))
    expect(await flags(s.c.id, 'expired')).toEqual([])
  })
})

describe('par suggestions, reports, and the timer', () => {
  it('suggests par levels from recent usage, and applies them on request', async () => {
    const s = await shiftSetup()
    const end = (cups: number): [string, number][] => [
      [s.cups, cups],
      [s.ice, 50],
      [s.cherry, 128],
      [s.blue, 64],
    ]
    await runShift(s, end(80)) // used 20
    await call(s.c.admin, 'transfer_stock', { from_place_id: s.warehouse, to_place_id: s.truck, lines: [{ supply_id: s.cups, quantity: 20 }] })
    await runShift(s, end(60)) // used 40
    await job('job_par_suggestions', s.c.id)
    const [cups] = await sql(`select suggested_qty::float as q, avg_used::float as avg from public.par_suggestions where supply_id = $1`, [s.cups])
    expect(cups).toEqual({ q: 38, avg: 30 }) // 30 a shift, plus 25% cushion, rounded up
    await as(s.manager, (q) => q(`select public.apply_par_suggestions($1)`, [s.truck]))
    expect((await sql(`select par_quantity::float as p from public.truck_pars where supply_id = $1`, [s.cups]))[0]?.p).toBe(38)
  })

  it('reports count the right shifts, and the timer runs each job once', async () => {
    const s = await shiftSetup()
    await sql(`update public.companies set timezone = 'UTC' where id = $1`, [s.c.id])
    await sql(`update public.company_settings set morning_hour = 0, daily_report_hour = 0 where company_id = $1`, [s.c.id])
    const shift = await s.start()
    await s.fn(s.lead, 'confirm_shift_start', shift)
    await call(s.lead, 'save_sales_tally', { shift_id: shift, lines: [{ key: 'a', product_size_id: s.small, quantity: 12 }] })
    await s.counts(s.lead, shift, 'end', [
      [s.cups, 80],
      [s.ice, 40],
      [s.cherry, 100],
      [s.blue, 60],
    ])
    await s.fn(s.lead, 'confirm_shift_end', shift)
    await s.fn(s.lead, 'finish_shift', shift, null)
    const [data] = await sql<{ d: Record<string, unknown> }>(`select app.report_data($1, now() - interval '1 hour', now() + interval '1 hour') as d`, [s.c.id])
    expect(data?.d).toMatchObject({ shifts: 1, drinks: 12, free: 0 })
    expect(Number(data?.d.used)).toBeCloseTo(20 * 0.1 + 10 * 0.3 + 32 * 0.1)

    // Run the timer "tomorrow": the daily report covers today.
    const tomorrow = new Date(Date.now() + 86400_000).toISOString()
    await sql(`select app.run_due_jobs($1)`, [tomorrow])
    await sql(`select app.run_due_jobs($1)`, [tomorrow])
    const reports = await outbox(s.c.id, 'report')
    expect(reports.map((r) => r.to_user).sort()).toEqual([s.c.admin.id, s.manager.id].sort())
    expect(reports[0]?.payload).toMatchObject({ kind: 'daily', shifts: 1 })
    expect(await sql(`select job from public.job_runs where company_id = $1 order by job`, [s.c.id])).toEqual([{ job: 'daily' }, { job: 'morning' }])
  })

  it('push subscriptions and job history stay private', async () => {
    const s = await shiftSetup()
    await as(s.lead, (q) =>
      q(`select public.save_push_subscription($1)`, [JSON.stringify({ endpoint: `https://push.example/${randomUUID()}`, p256dh: 'k', auth: 'a' })]),
    )
    expect(await as(s.lead, (q) => q(`select 1 from public.push_subscriptions`))).toHaveLength(1)
    expect(await as(s.crew, (q) => q(`select 1 from public.push_subscriptions`))).toEqual([])
    await expect(as(s.lead, (q) => q(`select * from public.service_push_targets($1)`, [s.lead.id]))).rejects.toThrow(/permission/)
    expect(await as('service', (q) => q(`select endpoint from public.service_push_targets($1)`, [s.lead.id]))).toHaveLength(1)
    const outsider = await addMember((await createCompany()).id, 'admin')
    for (const t of ['job_runs', 'par_suggestions', 'purchase_orders', 'notification_settings']) {
      expect(await as(outsider, (q) => q(`select 1 from public.${t} where company_id = $1`, [s.c.id])), t).toEqual([])
    }
  })

  it('finds old photos for cleanup', async () => {
    const s = await shiftSetup()
    const shift = await s.start()
    await s.fn(s.lead, 'confirm_shift_start', shift)
    await call(s.lead, 'log_waste', { shift_id: shift, supply_id: s.cups, quantity: 1, photo_path: `${s.c.id}/waste/old.jpg` })
    await sql(`update public.waste_logs set created_at = now() - interval '400 days' where shift_id = $1`, [shift])
    const old = await as('service', (q) => q<{ path: string }>(`select path from public.service_old_photos(1000)`))
    expect(old.map((o) => o.path)).toContain(`${s.c.id}/waste/old.jpg`)
    await as('service', (q) => q(`select public.service_forget_photos($1)`, [[`${s.c.id}/waste/old.jpg`]]))
    expect(await sql(`select photo_path from public.waste_logs where shift_id = $1`, [shift])).toEqual([{ photo_path: null }])
  })
})
