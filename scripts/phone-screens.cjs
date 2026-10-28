// Clicks through the app on a phone sized screen with a fake Supabase and saves
// screenshots, so screens can be checked without a real backend.
//
// How to run (needs Playwright with Chromium installed):
//   VITE_SUPABASE_URL=http://mock.supabase.test VITE_SUPABASE_PUBLISHABLE_KEY=anon npx vite build --outDir dist-mock
//   npx vite preview --outDir dist-mock --port 4173 &
//   node scripts/phone-screens.cjs
// Screenshots land in test-results/screens.
const { chromium } = require('playwright')

const OUT = process.env.OUT ?? require('node:path').join(__dirname, '../test-results/screens')
const base = process.env.BASE_URL ?? 'http://localhost:4173'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)

const user = { id: 'u-admin', email: 'sam@iceco.com', aud: 'authenticated', role: 'authenticated', user_metadata: { full_name: 'Sam Rivera' }, app_metadata: {} }
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: now + 3600 })}.sig`

const state = {
  me: {
    user_id: user.id,
    email: user.email,
    is_owner: false,
    profile: { full_name: 'Sam Rivera', role: 'admin', active: true, phone: null, joined_at: '2026-10-01' },
    company: { id: 'c1', name: 'Island Ice Co', status: 'pending', phone: '555 0100', timezone: 'America/Chicago', status_reason: null },
  },
  people: [
    { user_id: 'u-admin', full_name: 'Sam Rivera', email: 'sam@iceco.com', phone: null, role: 'admin', active: true, invited_at: null, joined_at: '2026-10-01' },
    { user_id: 'u-m1', full_name: 'Maria Lopez', email: 'maria@iceco.com', phone: '555 0101', role: 'manager', active: true, invited_at: '2026-10-02', joined_at: '2026-10-02' },
    { user_id: 'u-d1', full_name: 'Jake Turner', email: 'jake@iceco.com', phone: null, role: 'driver', active: true, invited_at: '2026-10-03', joined_at: '2026-10-03' },
    { user_id: 'u-d2', full_name: 'Ava Chen', email: 'ava@iceco.com', phone: null, role: 'driver', active: true, invited_at: '2026-10-20', joined_at: null },
    { user_id: 'u-d3', full_name: 'Leo Park', email: 'leo@iceco.com', phone: null, role: 'driver', active: false, invited_at: '2026-09-01', joined_at: '2026-09-02' },
  ],
  companies: [
    { id: 'c2', name: 'Bean There Coffee Trucks', status: 'pending', created_at: '2026-10-27T15:00:00Z', status_changed_at: null, status_reason: null, phone: '555 0200', truck_count_estimate: 4, signup_note: 'Found you through a friend at Kona.', timezone: 'America/Denver', admin_name: 'Dana Wu', admin_email: 'dana@beanthere.com', member_count: 1, last_active_at: '2026-10-27T15:05:00Z' },
    { id: 'c1', name: 'Island Ice Co', status: 'active', created_at: '2026-10-01T15:00:00Z', status_changed_at: '2026-10-01T16:00:00Z', status_reason: null, phone: '555 0100', truck_count_estimate: 6, signup_note: null, timezone: 'America/Chicago', admin_name: 'Sam Rivera', admin_email: 'sam@iceco.com', member_count: 5, last_active_at: '2026-10-28T12:00:00Z' },
  ],
  calls: [],
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'content-range' }
const json = (route, body, status = 200, headers = {}) =>
  route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

async function mock(page) {
  await page.route('http://mock.supabase.test/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const path = url.pathname
    state.calls.push(`${req.method()} ${path}`)
    if (path === '/auth/v1/token') return json(route, { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })
    if (path === '/auth/v1/user') return json(route, user)
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors })
    if (path === '/rest/v1/rpc/my_context') return json(route, state.me)
    if (path === '/rest/v1/rpc/owner_list_companies') return json(route, state.companies)
    if (path === '/rest/v1/rpc/owner_stats') return json(route, { database_bytes: 31 * 1024 * 1024, database_limit_bytes: 500 * 1024 * 1024, companies: { active: 1, pending: 1 }, people: 6 })
    if (path.startsWith('/rest/v1/rpc/')) return json(route, null)
    if (path === '/rest/v1/profiles') {
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-4/${state.people.length}` } })
      return json(route, state.people)
    }
    if (path === '/functions/v1/manage-invite') return json(route, { ok: true, action: 'invite' })
    return json(route, { message: 'not mocked ' + path }, 404)
  })
}

;(async () => {
  require('fs').mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await mock(page)
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })

  await page.goto(`${base}/login`)
  await page.getByRole('heading', { name: 'Log in' }).waitFor()
  await shot('01-login')

  await page.goto(`${base}/signup`)
  await shot('02-signup')

  await page.goto(`${base}/login`)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill('secret123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByText('Hi, Sam').waitFor()
  await shot('03-home-pending')

  await page.getByRole('link', { name: 'People' }).last().click()
  await page.getByText('Jake Turner').waitFor()
  await shot('04-people-pending')

  // Approved now.
  state.me.company.status = 'active'
  await page.goto(`${base}/people`)
  await page.getByText('Jake Turner').waitFor()
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await page.getByLabel('Name').fill('Riley Brooks')
  await page.getByLabel('Email').fill('riley@iceco.com')
  await shot('05-invite-sheet')
  await page.getByRole('button', { name: 'Send invite' }).click()
  await page.getByText('Invite sent to riley@iceco.com').waitFor()
  await shot('06-invite-sent')

  await page.getByText('Ava Chen').click()
  await page.getByRole('button', { name: 'Send the invite again' }).waitFor()
  await shot('07-person-invited')
  await page.getByRole('button', { name: 'Close' }).last().click()

  await page.goto(`${base}/settings`)
  await page.getByLabel('Business name').waitFor()
  await shot('08-settings')

  state.me.is_owner = true
  await page.goto(`${base}/owner`)
  await page.getByText('Bean There Coffee Trucks').waitFor()
  await shot('09-owner')
  await page.getByRole('button', { name: 'Decline' }).click()
  await shot('10-owner-decline')
  await page.getByRole('button', { name: 'Close' }).last().click()

  state.me.is_owner = false
  state.me.profile.role = 'driver'
  state.me.profile.full_name = 'Jake Turner'
  await page.goto(`${base}/`)
  await page.getByText('Hi, Jake').waitFor()
  await shot('11-driver-home')

  await page.goto(`${base}/people`)
  await page.waitForURL(`${base}/`)

  await page.goto(`${base}/account`)
  await page.getByRole('heading', { name: 'My account' }).waitFor()
  await shot('12-account')

  // Desktop view
  await page.setViewportSize({ width: 1280, height: 800 })
  state.me.profile.role = 'admin'
  state.me.profile.full_name = 'Sam Rivera'
  state.me.is_owner = true
  await page.goto(`${base}/people`)
  await page.getByText('Jake Turner').waitFor()
  await shot('13-desktop-people')

  console.log('errors:', JSON.stringify(errors, null, 1))
  console.log('calls:', [...new Set(state.calls)].join(', '))
  await browser.close()
})().catch((e) => {
  console.error('FAILED', e)
  process.exit(1)
})
