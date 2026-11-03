import { assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1'
import { parseFrom } from './mailer.ts'
import { escapeHtml, eventWhen, renderTemplate } from './templates.ts'

const ctx = { appName: 'Food Truck IM', siteUrl: 'https://app.example.com' }

Deno.test('escapes names so they cannot inject html', () => {
  assertEquals(escapeHtml('<b>"Tom\'s" & Co</b>'), '&lt;b&gt;&quot;Tom&#39;s&quot; &amp; Co&lt;/b&gt;')
  const mail = renderTemplate(
    'owner_new_signup',
    { company_name: '<script>x</script>', admin_name: 'A', admin_email: 'a@b.com' },
    ctx,
  )
  assertEquals(mail.html.includes('<script>'), false)
  assertStringIncludes(mail.html, '&lt;script&gt;')
})

Deno.test('owner sign up email links to the owner section', () => {
  const mail = renderTemplate('owner_new_signup', { company_name: 'Ice Co', admin_name: 'Sam', admin_email: 's@x.com' }, ctx)
  assertEquals(mail.subject, 'New sign up: Ice Co')
  assertStringIncludes(mail.text, 'https://app.example.com/owner')
})

Deno.test('status emails pick the right wording', () => {
  const base = { company_name: 'Ice Co', admin_name: 'Sam' }
  assertEquals(renderTemplate('company_status_changed', { ...base, status: 'active' }, ctx).subject, 'Ice Co is approved')
  assertEquals(
    renderTemplate('company_status_changed', { ...base, status: 'active', old_status: 'suspended' }, ctx).subject,
    'Ice Co is back on',
  )
  assertStringIncludes(
    renderTemplate('company_status_changed', { ...base, status: 'declined', reason: 'Test account' }, ctx).text,
    'Test account',
  )
})

Deno.test('unknown templates fail loudly', () => {
  assertThrows(() => renderTemplate('nope', {}, ctx))
})

Deno.test('reads the from address', () => {
  assertEquals(parseFrom('Food Truck IM <app@gmail.com>'), { name: 'Food Truck IM', email: 'app@gmail.com' })
  assertEquals(parseFrom('app@gmail.com'), { email: 'app@gmail.com' })
})

Deno.test('reports show the numbers and the money', () => {
  const mail = renderTemplate(
    'report',
    {
      kind: 'daily', label: 'Monday, Nov 2', company_name: 'Ice Co', shifts: 2, drinks: 120, free: 4, revenue: 500, used: 120.5, waste: 9.5,
      flagged_shifts: 1, open_flags: 3, top_flags: ['Truck 1 used different amounts than sales show'],
      trucks: [{ name: 'Truck 1', shifts: 1, drinks: 60, revenue: 250, used: 60, waste: 5 }, { name: 'Truck 2', shifts: 1, drinks: 60, revenue: 250, used: 60.5, waste: 4.5 }],
    },
    ctx,
  )
  assertEquals(mail.subject, 'Daily report: Ice Co')
  assertStringIncludes(mail.text, 'Sales minus supplies and waste: $370.00')
  assertStringIncludes(mail.text, '* Truck 2: 1 shifts, 60 drinks, $250.00 sales')
  assertStringIncludes(mail.html, 'Needs a look (3 open)')
})

Deno.test('the morning email lists what matters today', () => {
  const mail = renderTemplate(
    'morning_summary',
    { company_name: 'Ice Co', date: 'Monday, Nov 2', low: [{ name: 'Cups', left: '3 sleeves' }], orders: ['Paper Co'], expiring: [], count_checks: 1, planned: [] },
    ctx,
  )
  assertStringIncludes(mail.text, '* Cups: 3 sleeves left')
  assertStringIncludes(mail.text, '1 shift is waiting for a count check.')
})

Deno.test('supplier orders list the lines, and alerts only link inside the app', () => {
  const order = renderTemplate(
    'supplier_order',
    { company_name: 'Ice Co', company_phone: '555 0100', supplier_name: 'Paper Co', lines: [{ name: 'Cups', amount: '2 cases' }] },
    ctx,
  )
  assertStringIncludes(order.text, '* Cups: 2 cases')
  assertStringIncludes(order.text, 'at 555 0100')
  assertEquals(order.replyTo, undefined)
  const replied = renderTemplate('supplier_order', { company_name: 'Ice Co', supplier_name: 'Paper Co', lines: [], reply_to: 'maria@iceco.test' }, ctx)
  assertEquals(replied.replyTo, 'maria@iceco.test')
  const alert = renderTemplate('alert', { title: 'Low on Cups', body: '3 left', url: 'https://evil.example' }, ctx)
  assertStringIncludes(alert.text, 'Open the app: https://app.example.com/')
})

const booking = {
  company_name: 'Ice Co', company_phone: '555 0100', timezone: 'America/Chicago', client_name: 'Pat',
  event_name: 'Spring fair', place: '1 School Rd', starts_at: '2026-05-09T17:00:00Z', ends_at: '2026-05-09T20:00:00Z',
}

Deno.test('booking emails to clients carry the business name and reply to the manager', () => {
  assertEquals(eventWhen(booking), 'Saturday, May 9, 12:00 PM to 3:00 PM')
  const yes = renderTemplate('booking_accepted', { ...booking, message: 'See you there', reply_to: 'maria@iceco.test' }, ctx)
  assertEquals(yes.subject, 'Your booking with Ice Co is confirmed')
  assertEquals(yes.replyTo, 'maria@iceco.test')
  assertStringIncludes(yes.html, '>Ice Co</p>')
  assertStringIncludes(yes.text, 'Note from Ice Co: See you there')
  const no = renderTemplate('booking_declined', { ...booking, booking_slug: 'ice-co' }, ctx)
  assertStringIncludes(no.text, 'Pick another day: https://app.example.com/book/ice-co')
})

Deno.test('event emails to the crew list the people, the contact, and what to bring', () => {
  const mail = renderTemplate(
    'booking_staff',
    { ...booking, kind: 'new', truck: 'Truck 1', lead: 'Jake', crew: ['Ava'], contact_name: 'Ms Lee', contact_phone: '555 0199',
      supplies: [{ name: 'Cups', amount: '6 sleeves' }], notes: 'Park by the gym', url: '/schedule' },
    ctx,
  )
  assertEquals(mail.subject, "You're on an event: Spring fair")
  assertStringIncludes(mail.text, 'On site contact: Ms Lee, 555 0199')
  assertStringIncludes(mail.text, '* Cups: 6 sleeves')
  assertStringIncludes(mail.text, 'Open the schedule: https://app.example.com/schedule')
  const off = renderTemplate('booking_staff', { ...booking, kind: 'cancelled', supplies: [{ name: 'Cups', amount: '1' }] }, ctx)
  assertEquals(off.subject, 'Event cancelled: Spring fair')
  assertEquals(off.text.includes('Cups'), false)
})
