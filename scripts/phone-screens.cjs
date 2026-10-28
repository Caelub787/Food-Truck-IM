// Clicks through the app on phone and desktop screens with a fake Supabase
// (including a fake live connection) and saves screenshots. It also checks
// that changes made "by someone else" show up without reloading the page.
//
// How to run (needs Playwright with Chromium installed):
//   VITE_SUPABASE_URL=http://mock.supabase.test VITE_SUPABASE_PUBLISHABLE_KEY=anon npx vite build --outDir dist-mock
//   npx vite preview --outDir dist-mock --port 4173 &
//   node scripts/phone-screens.cjs
// Screenshots land in test-results/screens. The script exits with an error if a check fails.
const { chromium } = require('playwright')
const path = require('node:path')

const OUT = process.env.OUT ?? path.join(__dirname, '../test-results/screens')
const base = process.env.BASE_URL ?? 'http://localhost:4173'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)

const user = { id: 'u-admin', email: 'sam@iceco.com', aud: 'authenticated', role: 'authenticated', user_metadata: { full_name: 'Sam Rivera' }, app_metadata: {} }
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: now + 3600 })}.sig`

function freshState() {
  return {
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
      { id: 'c2', name: 'Bean There Coffee Trucks', status: 'pending', created_at: '2026-10-27T15:00:00Z', status_changed_at: null, status_reason: null, phone: '555 0200', truck_count_estimate: 4, signup_note: 'Found you through a friend.', timezone: 'America/Denver', admin_name: 'Dana Wu', admin_email: 'dana@beanthere.com', member_count: 1, last_active_at: '2026-10-27T15:05:00Z' },
      { id: 'c1', name: 'Island Ice Co', status: 'active', created_at: '2026-10-01T15:00:00Z', status_changed_at: '2026-10-01T16:00:00Z', status_reason: null, phone: '555 0100', truck_count_estimate: 6, signup_note: null, timezone: 'America/Chicago', admin_name: 'Sam Rivera', admin_email: 'sam@iceco.com', member_count: 5, last_active_at: '2026-10-28T12:00:00Z' },
    ],
  }
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'content-range' }
const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function mockSupabase(page, state) {
  await page.route('http://mock.supabase.test/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const p = new URL(req.url()).pathname
    if (p === '/auth/v1/token') return json(route, { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })
    if (p === '/auth/v1/user') return json(route, user)
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors })
    if (p === '/rest/v1/rpc/my_context') return json(route, state.me)
    if (p === '/rest/v1/rpc/owner_list_companies') return json(route, state.companies)
    if (p === '/rest/v1/rpc/owner_stats') return json(route, { database_bytes: 31 * 1024 * 1024, database_limit_bytes: 500 * 1024 * 1024, companies: { active: 1, pending: state.companies.filter((c) => c.status === 'pending').length }, people: 6 })
    if (p.startsWith('/rest/v1/rpc/')) return json(route, null)
    if (p === '/rest/v1/profiles') {
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-0/${state.people.length}` } })
      return json(route, state.people)
    }
    if (p === '/functions/v1/manage-invite') return json(route, { ok: true, action: 'invite' })
    return json(route, { message: `not mocked ${p}` }, 404)
  })

  // A fake Supabase Realtime server: accepts channel joins and lets the test send signals.
  const live = { socket: null, joined: new Set(), refuse: false }
  await page.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    if (live.refuse) return ws.close()
    live.socket = ws
    ws.onMessage((raw) => {
      if (typeof raw !== 'string') return
      const [joinRef, ref, topic, event] = JSON.parse(raw)
      if (event === 'phx_join') {
        live.joined.add(topic)
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: [] } }]))
      } else if (event === 'heartbeat' || event === 'phx_leave') {
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]))
      }
    })
  })
  live.drop = () => {
    live.refuse = true
    live.joined.clear()
    live.socket?.close()
    live.socket = null
  }
  live.allow = () => (live.refuse = false)
  live.signal = (topic, table) => {
    if (!live.socket) throw new Error('No live connection was opened')
    if (!live.joined.has(`realtime:${topic}`)) throw new Error(`The app never joined ${topic}`)
    live.socket.send(JSON.stringify([null, null, `realtime:${topic}`, 'broadcast', { type: 'broadcast', event: 'change', payload: { table, op: 'update' } }]))
  }
  return live
}

/** Fails if the page reloaded since markPage() was called. */
async function markPage(page) {
  await page.evaluate(() => (window.__noReload = true))
}
async function assertNoReload(page, what) {
  if (!(await page.evaluate(() => window.__noReload === true))) throw new Error(`Page reloaded during: ${what}`)
}

async function run(browser, size, label) {
  const state = freshState()
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2, serviceWorkers: 'block' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()))
  const live = await mockSupabase(page, state)
  const shot = (name) => page.screenshot({ path: `${OUT}/${label}-${name}.png`, fullPage: true })
  const checks = []
  const check = (name) => checks.push(name)

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
  await page.getByText('Live', { exact: true }).filter({ visible: true }).first().waitFor()
  check('live light turns on after login')
  await shot('03-home-pending')

  // The App Owner approves the business on another device. The banner should go away by itself.
  await markPage(page)
  state.me.company.status = 'active'
  live.signal('company:c1', 'companies')
  await page.getByText('Waiting for approval.').waitFor({ state: 'detached', timeout: 3000 })
  await assertNoReload(page, 'approval')
  check('approval shows up live')
  await shot('04-home-approved')

  await page.getByRole('link', { name: 'People' }).first().click()
  await page.getByText('Jake Turner').filter({ visible: true }).first().waitFor()

  // A manager on another phone renames Jake and invites someone. Both show up by themselves.
  await markPage(page)
  state.people[2].full_name = 'Jake T. Turner'
  state.people.push({ user_id: 'u-d4', full_name: 'Riley Brooks', email: 'riley@iceco.com', phone: null, role: 'driver', active: true, invited_at: '2026-10-28', joined_at: null })
  live.signal('company:c1', 'profiles')
  await page.getByText('Jake T. Turner').filter({ visible: true }).first().waitFor({ timeout: 3000 })
  await page.getByText('Riley Brooks').filter({ visible: true }).first().waitFor({ timeout: 3000 })
  await assertNoReload(page, 'people changes')
  check('people list updates live')
  await shot('05-people')

  // The connection drops (bad signal). The light changes, then it reconnects by itself,
  // and a change made while it was down still shows up.
  live.drop()
  await page.getByText('Reconnecting').filter({ visible: true }).first().waitFor({ timeout: 10000 })
  check('light shows when the live connection drops')
  await shot('05b-reconnecting')
  state.people[1].full_name = 'Maria L. Lopez'
  live.allow()
  await page.getByText('Live', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 20000 })
  await page.getByText('Maria L. Lopez').filter({ visible: true }).first().waitFor({ timeout: 3000 })
  await assertNoReload(page, 'reconnect')
  check('reconnects by itself and catches up on missed changes')

  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await page.getByLabel('Name').fill('Casey Morgan')
  await page.getByLabel('Email').fill('casey@iceco.com')
  await shot('06-invite-sheet')
  await page.getByRole('button', { name: 'Send invite' }).click()
  await page.getByText('Invite sent to casey@iceco.com').waitFor()

  // Open Ava's panel, then she accepts her invite on her own phone. The panel updates while open.
  await page.getByText('Ava Chen').filter({ visible: true }).first().click()
  await page.getByRole('button', { name: 'Send the invite again' }).waitFor()
  await shot('07-person-invited')
  state.people[3].joined_at = '2026-10-28'
  live.signal('company:c1', 'profiles')
  await page.getByRole('button', { name: /Turn off/ }).waitFor({ timeout: 3000 })
  check('open panel updates live')
  await page.getByRole('button', { name: 'Close' }).last().click()

  await page.goto(`${base}/settings`)
  await page.getByLabel('Business name').waitFor()
  await shot('08-settings')

  await page.goto(`${base}/account`)
  await page.getByRole('heading', { name: 'My account' }).waitFor()
  await shot('09-account')

  // App Owner: a new business signs up while the owner screen is open.
  state.me.is_owner = true
  await page.goto(`${base}/owner`)
  await page.getByText('Bean There Coffee Trucks').waitFor()
  await markPage(page)
  state.companies.unshift({ ...state.companies[0], id: 'c3', name: 'Rolling Scoops', admin_name: 'Pat Lee', admin_email: 'pat@scoops.com', signup_note: null })
  live.signal('owner', 'companies')
  await page.getByText('Rolling Scoops').waitFor({ timeout: 3000 })
  await assertNoReload(page, 'new sign up')
  check('owner sees new sign ups live')
  await shot('10-owner')

  // Turned off on another device: the person is shut out right away.
  state.me.is_owner = false
  await page.goto(`${base}/`)
  await page.getByText('Hi, Sam').waitFor()
  state.me.profile.active = false
  live.signal('company:c1', 'profiles')
  await page.getByText('Your account is turned off').waitFor({ timeout: 3000 })
  check('turned off person is shut out live')
  await shot('11-turned-off')

  // Driver view
  state.me.profile = { full_name: 'Jake Turner', role: 'driver', active: true, phone: null, joined_at: '2026-10-03' }
  await page.goto(`${base}/`)
  await page.getByText('Hi, Jake').waitFor()
  await shot('12-driver-home')
  await page.goto(`${base}/people`)
  await page.waitForURL(`${base}/`)
  check('drivers cannot open People')

  await context.close()
  return { checks, errors }
}

;(async () => {
  require('node:fs').mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  let failed = false
  for (const [label, size] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1366, height: 860 }],
  ]) {
    const { checks, errors } = await run(browser, size, label)
    console.log(`${label}: ${checks.length} checks passed: ${checks.join('; ')}`)
    if (errors.length) {
      failed = true
      console.log(`${label} page errors:`, errors)
    }
  }
  await browser.close()
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error('FAILED', e)
  process.exit(1)
})
