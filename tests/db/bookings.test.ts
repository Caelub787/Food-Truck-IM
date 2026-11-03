import { describe, expect, it } from 'vitest'
import { call, shiftSetup, type Json, type ShiftSetup } from './fixtures'
import { addMember, as, createCompany, sql, type Company } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = Record<string, any> | null

/** A day this many days from now, in the business's time zone. */
const day = (ahead: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(Date.now() + ahead * 864e5))
const page = async (slug: string) => (await as('anon', (q) => q<{ r: Page }>(`select public.booking_page($1) as r`, [slug])))[0]!.r
const ask = (slug: string, p: Json) => as('anon', (q) => q(`select public.request_booking($1, $2) as r`, [slug, JSON.stringify(p)]))
const request = (extra: Json = {}): Json => ({
  date: day(10), start: '12:00', end: '15:00', name: 'Pat Client', email: 'pat@school.test', phone: '555 0111',
  event_name: 'Spring fair', place: '1 School Rd', guests: '300', ...extra,
})
const outbox = (company: string, template: string) =>
  sql<{ to_user: string | null; to_email: string | null; payload: Json; channel: string }>(
    `select to_user, to_email, payload, channel from public.outbox where company_id = $1 and template = $2 order by created_at`,
    [company, template],
  )

async function openBookings(c: Company) {
  await as(c.admin, (q) => q(`update public.company_settings set bookings_enabled = true where company_id = $1`, [c.id]))
  const [row] = await sql<{ booking_slug: string; scheduling_enabled: boolean }>(
    `select booking_slug, scheduling_enabled from public.company_settings where company_id = $1`, [c.id])
  return row!
}

async function pendingBooking(s: ShiftSetup, extra: Json = {}) {
  const { booking_slug } = await openBookings(s.c)
  await ask(booking_slug, request(extra))
  const [b] = await sql<{ id: string }>(`select id from public.bookings where company_id = $1 and status = 'pending' order by created_at desc`, [s.c.id])
  return b!.id
}

const accept = (s: ShiftSetup, booking: string, extra: Json = {}) =>
  call(s.manager, 'decide_booking', {
    booking_id: booking, action: 'accept', truck_id: s.truck, lead_id: s.lead.id, crew_ids: [s.crew.id], manager_id: s.manager.id,
    contact_name: 'Ms Lee', contact_phone: '555 0199', crew_notes: 'Park by the gym', price: 500,
    supplies: [{ supply_id: s.cups, quantity: 300 }], message: 'See you there!', ...extra,
  })

describe('booking page', () => {
  it('turning bookings on makes a page name and turns on scheduling', async () => {
    const c = await createCompany()
    const { booking_slug, scheduling_enabled } = await openBookings(c)
    expect(booking_slug).toMatch(/^test-co-admin/)
    expect(scheduling_enabled).toBe(true)
    const info = await page(booking_slug)
    expect(info).toMatchObject({ open: '08:00', close: '22:00', capacity: 1, busy: [] })

    // Another business can't take the same name.
    const other = await createCompany()
    await expect(
      as(other.admin, (q) => q(`update public.company_settings set booking_slug = $1 where company_id = $2`, [booking_slug, other.id])),
    ).rejects.toThrow(/taken/)

    // Turned off, or a business that isn't approved, shows nothing.
    await as(c.admin, (q) => q(`update public.company_settings set bookings_enabled = false where company_id = $1`, [c.id]))
    expect(await page(booking_slug)).toBeNull()
    const pending = await createCompany('pending')
    const { booking_slug: waiting } = await openBookings(pending)
    expect(await page(waiting)).toBeNull()
  })

  it('checks every request, stops robots, and limits how many come in', async () => {
    const s = await shiftSetup()
    const { booking_slug: slug } = await openBookings(s.c)
    await expect(ask(slug, request({ date: day(1) }))).rejects.toThrow(/at least 3 days/)
    await expect(ask(slug, request({ start: '06:00' }))).rejects.toThrow(/between 8:00 AM and 10:00 PM/)
    await expect(ask(slug, request({ end: '11:00' }))).rejects.toThrow(/after the start/)
    await expect(ask(slug, request({ email: 'nope' }))).rejects.toThrow(/real email/)
    await expect(ask(slug, request({ place: ' ' }))).rejects.toThrow(/where the event is/)
    await expect(ask('no-such-truck', request())).rejects.toThrow(/isn't taking bookings/)

    const dow = new Date(`${day(10)}T12:00:00Z`).getUTCDay()
    await as(s.c.admin, (q) => q(`update public.company_settings set booking_days = $1 where company_id = $2`, [[(dow + 1) % 7], s.c.id]))
    await expect(ask(slug, request())).rejects.toThrow(/isn't open/)
    await as(s.c.admin, (q) => q(`update public.company_settings set booking_days = '{0,1,2,3,4,5,6}' where company_id = $1`, [s.c.id]))

    // The hidden box only robots fill in: looks fine, saves nothing.
    expect((await ask(slug, request({ website: 'spam.example' })))[0]!.r).toEqual({ ok: true })
    expect(await sql(`select 1 from public.bookings where company_id = $1`, [s.c.id])).toEqual([])

    await ask(slug, request())
    const [saved] = await sql(`select status, client_email, guests, event_name from public.bookings where company_id = $1`, [s.c.id])
    expect(saved).toEqual({ status: 'pending', client_email: 'pat@school.test', guests: 300, event_name: 'Spring fair' })
    const pushes = await outbox(s.c.id, 'push')
    expect(pushes.some((p) => p.payload.title === 'New booking request' && p.to_user === s.manager.id)).toBe(true)

    // Three waiting requests from one email is the most.
    await ask(slug, request({ date: day(11) }))
    await ask(slug, request({ date: day(12), email: 'PAT@school.test' }))
    await expect(ask(slug, request({ date: day(13) }))).rejects.toThrow(/already have requests waiting/)

    // One truck, and that time is on the schedule already.
    await call(s.manager, 'save_schedule', {
      truck_id: s.truck, starts_at: `${day(20)}T17:00:00Z`, ends_at: `${day(20)}T23:00:00Z`, lead_id: s.lead.id,
    })
    await expect(ask(slug, request({ date: day(20), email: 'sam@club.test' }))).rejects.toThrow(/already booked/)
    expect((await page(slug))!.busy).toHaveLength(1)
  })
})

describe('deciding bookings', () => {
  it('accepting puts it on the schedule and tells the crew, the manager, and the client', async () => {
    const s = await shiftSetup()
    const booking = await pendingBooking(s)

    await expect(accept({ ...s, manager: s.lead }, booking)).rejects.toThrow(/permission/)
    const other = await createCompany()
    await expect(call(other.admin, 'decide_booking', { booking_id: booking, action: 'decline' })).rejects.toThrow(/not found/)
    expect(await as(other.admin, (q) => q(`select 1 from public.bookings where company_id = $1`, [s.c.id]))).toEqual([])
    await expect(as('anon', (q) => q(`select 1 from public.bookings`))).rejects.toThrow(/permission/)

    await accept(s, booking)
    const [b] = await sql<{ status: string; schedule_id: string; price: string; contact_name: string }>(
      `select status, schedule_id, price, contact_name from public.bookings where id = $1`, [booking])
    expect(b).toMatchObject({ status: 'accepted', contact_name: 'Ms Lee' })
    expect(Number(b!.price)).toBe(500)
    const [plan] = await sql(`select truck_id, lead_id, event_name, place, notes from public.schedules where id = $1`, [b!.schedule_id])
    expect(plan).toEqual({ truck_id: s.truck, lead_id: s.lead.id, event_name: 'Spring fair', place: '1 School Rd', notes: 'Park by the gym' })
    expect(await sql(`select user_id from public.schedule_crew where schedule_id = $1`, [b!.schedule_id])).toEqual([{ user_id: s.crew.id }])

    const [client] = await outbox(s.c.id, 'booking_accepted')
    const [manager] = await sql<{ email: string }>(`select email from public.profiles where user_id = $1`, [s.manager.id])
    expect(client).toMatchObject({ to_email: 'pat@school.test', payload: { reply_to: manager!.email, message: 'See you there!', place: '1 School Rd' } })
    const staff = await outbox(s.c.id, 'booking_staff')
    expect(staff.map((m) => m.to_user).sort()).toEqual([s.lead.id, s.crew.id, s.manager.id].sort())
    expect(staff[0]!.payload).toMatchObject({ kind: 'new', truck: 'Truck 1', contact_phone: '555 0199', supplies: [{ name: 'Cups', amount: '300' }] })

    // People on it see the booking and what it needs. Other drivers don't.
    expect(await as(s.lead, (q) => q(`select contact_name from public.bookings`))).toEqual([{ contact_name: 'Ms Lee' }])
    expect(await as(s.crew, (q) => q(`select quantity::int as q from public.booking_supplies`))).toEqual([{ q: 300 }])
    const bystander = await addMember(s.c.id, 'driver')
    expect(await as(bystander, (q) => q(`select 1 from public.bookings`))).toEqual([])
    expect(await as(bystander, (q) => q(`select 1 from public.booking_supplies`))).toEqual([])

    await expect(accept(s, booking)).rejects.toThrow(/already answered/)

    // Changing it moves the plan and tells the people on it again.
    await call(s.manager, 'update_booking', {
      booking_id: booking, truck_id: s.truck, lead_id: s.crew.id, crew_ids: [], manager_id: s.manager.id,
      starts_at: `${day(10)}T18:00:00Z`, ends_at: `${day(10)}T21:00:00Z`, supplies: [{ supply_id: s.ice, quantity: 40 }],
    })
    expect(await sql(`select lead_id from public.schedules where id = $1`, [b!.schedule_id])).toEqual([{ lead_id: s.crew.id }])
    expect(await sql(`select supply_id from public.booking_supplies where booking_id = $1`, [booking])).toEqual([{ supply_id: s.ice }])
    expect((await outbox(s.c.id, 'booking_staff')).filter((m) => m.payload.kind === 'updated').map((m) => m.to_user).sort())
      .toEqual([s.crew.id, s.manager.id].sort())
  })

  it('declining and cancelling tell the client and clear the schedule', async () => {
    const s = await shiftSetup()
    const first = await pendingBooking(s)
    await call(s.manager, 'decide_booking', { booking_id: first, action: 'decline', message: 'Sorry, we are booked.' })
    expect(await sql(`select status, decision_message from public.bookings where id = $1`, [first]))
      .toEqual([{ status: 'declined', decision_message: 'Sorry, we are booked.' }])
    expect((await outbox(s.c.id, 'booking_declined'))[0]).toMatchObject({ to_email: 'pat@school.test' })

    const second = await pendingBooking(s, { date: day(15), email: 'kim@club.test' })
    await accept(s, second)
    const [{ schedule_id }] = (await sql(`select schedule_id from public.bookings where id = $1`, [second])) as [{ schedule_id: string }]
    await as(s.manager, (q) => q(`select public.cancel_booking($1, $2, true)`, [second, 'The truck broke down.']))
    expect(await sql(`select status from public.bookings where id = $1`, [second])).toEqual([{ status: 'cancelled' }])
    expect(await sql(`select status from public.schedules where id = $1`, [schedule_id])).toEqual([{ status: 'cancelled' }])
    expect((await outbox(s.c.id, 'booking_cancelled'))[0]).toMatchObject({ to_email: 'kim@club.test', payload: { message: 'The truck broke down.' } })
    expect((await outbox(s.c.id, 'booking_staff')).filter((m) => m.payload.kind === 'cancelled')).toHaveLength(3)
    await expect(as(s.manager, (q) => q(`select public.cancel_booking($1)`, [second]))).rejects.toThrow(/already closed/)
  })
})
