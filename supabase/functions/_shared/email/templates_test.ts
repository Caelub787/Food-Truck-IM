import { assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1'
import { parseFrom } from './mailer.ts'
import { escapeHtml, renderTemplate } from './templates.ts'

const ctx = { appName: 'TruckStock', siteUrl: 'https://app.example.com' }

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
  assertEquals(parseFrom('TruckStock <app@gmail.com>'), { name: 'TruckStock', email: 'app@gmail.com' })
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
  const alert = renderTemplate('alert', { title: 'Low on Cups', body: '3 left', url: 'https://evil.example' }, ctx)
  assertStringIncludes(alert.text, 'Open the app: https://app.example.com/')
})
