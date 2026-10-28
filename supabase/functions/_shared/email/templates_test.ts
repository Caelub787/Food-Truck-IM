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
