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
const { setupTables, addShiftData } = require('./mock-data.cjs')

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
    tables: setupTables(),
    rpcs: {},
    companies: [
      { id: 'c2', name: 'Bean There Coffee Trucks', status: 'pending', created_at: '2026-10-27T15:00:00Z', status_changed_at: null, status_reason: null, phone: '555 0200', truck_count_estimate: 4, signup_note: 'Found you through a friend.', timezone: 'America/Denver', admin_name: 'Dana Wu', admin_email: 'dana@beanthere.com', member_count: 1, last_active_at: '2026-10-27T15:05:00Z' },
      { id: 'c1', name: 'Island Ice Co', status: 'active', created_at: '2026-10-01T15:00:00Z', status_changed_at: '2026-10-01T16:00:00Z', status_reason: null, phone: '555 0100', truck_count_estimate: 6, signup_note: null, timezone: 'America/Chicago', admin_name: 'Sam Rivera', admin_email: 'sam@iceco.com', member_count: 5, last_active_at: '2026-10-28T12:00:00Z' },
    ],
  }
}

// A small red square, for photos.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGO4Y2NDEmIY1TCqYfhqAABhl1QQ50OvrwAAAABJRU5ErkJggg=='

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'content-range' }
const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function mockSupabase(page, state) {
  await page.route('http://mock.supabase.test/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    // Playwright's offline mode doesn't stop mocked requests, so do it here.
    if (state.offline) return route.abort('internetdisconnected')
    const p = new URL(req.url()).pathname
    if (p === '/auth/v1/token') return json(route, { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user })
    if (p === '/auth/v1/user') return json(route, user)
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors })
    if (p === '/rest/v1/rpc/my_context') return json(route, state.me)
    if (p === '/rest/v1/rpc/owner_list_companies') return json(route, state.companies)
    if (p === '/rest/v1/rpc/owner_stats') return json(route, { database_bytes: 31 * 1024 * 1024, database_limit_bytes: 500 * 1024 * 1024, companies: { active: 1, pending: state.companies.filter((c) => c.status === 'pending').length }, people: 6 })
    if (p === '/rest/v1/rpc/setup_progress') {
      const t = state.tables
      return json(route, { locations: t.locations.length, trucks: t.trucks.length, suppliers: t.suppliers.length, supplies: t.supplies.length, products: t.products.length, recipes: t.recipe_versions.length, people: state.people.length })
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const name = p.slice('/rest/v1/rpc/'.length)
      const handler = state.rpcs[name]
      return json(route, handler ? handler(req.postDataJSON()) : null)
    }
    if (p === '/rest/v1/profiles') {
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-0/${state.people.length}` } })
      return json(route, state.people)
    }
    if (p === '/functions/v1/manage-invite') return json(route, { ok: true, action: 'invite' })
    // Photo storage: uploads, signed links, and the photo itself.
    if (p.startsWith('/storage/v1/object/sign/')) {
      if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'image/png' }, body: Buffer.from(PNG, 'base64') })
      return json(route, { signedURL: `${p.slice('/storage/v1'.length)}?token=t` })
    }
    if (p.startsWith('/storage/v1/object/photos/')) {
      state.uploads = [...(state.uploads ?? []), p.slice('/storage/v1/object/photos/'.length)]
      return json(route, { Key: p.slice('/storage/v1/object/'.length), Id: 'x' })
    }
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : null
    if (table && state.tables[table]) {
      if (req.method() !== 'GET') return json(route, req.method() === 'POST' ? { id: `new-${Date.now()}` } : null)
      let rows = state.tables[table]
      for (const [key, value] of new URL(req.url()).searchParams) {
        if (value.startsWith('eq.')) rows = rows.filter((r) => String(r[key]) === value.slice(3))
        if (value.startsWith('in.(')) {
          const allowed = value.slice(4, -1).split(',')
          rows = rows.filter((r) => allowed.includes(String(r[key])))
        }
      }
      if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(route, rows[0] ?? null)
      return json(route, rows)
    }
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

  // On phones People is under More, on desktop it's in the side menu.
  const people = page.getByRole('link', { name: 'People' }).filter({ visible: true })
  if ((await people.count()) === 0) await page.getByRole('link', { name: 'More' }).filter({ visible: true }).first().click()
  await people.first().click()
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

/** Opens a fresh logged in page as an admin of an approved business. */
async function openAsAdmin(browser, size, label) {
  const state = freshState()
  state.me.company.status = 'active'
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2, serviceWorkers: 'block' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/404|INTERNET_DISCONNECTED/.test(m.text()) && errors.push(m.text()))
  const live = await mockSupabase(page, state)
  await page.goto(`${base}/login`)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill('secret123')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByText('Live', { exact: true }).filter({ visible: true }).first().waitFor()
  const shot = (name) => page.screenshot({ path: `${OUT}/${label}-${name}.png`, fullPage: true })
  const seen = (text) => page.getByText(text).filter({ visible: true }).first()
  return { state, context, page, live, errors, shot, seen }
}

async function runSetup(browser, size, label) {
  const { state, context, page, live, errors, shot, seen } = await openAsAdmin(browser, size, label)
  const checks = []

  await page.goto(`${base}/setup`)
  await seen('Starter kits').waitFor()
  await shot('20-setup')

  await page.goto(`${base}/setup/supplies`)
  await seen('Whole milk').waitFor()
  await shot('21-supplies')

  // A manager adds a supply on another device.
  await markPage(page)
  state.tables.supplies.push({ ...state.tables.supplies[0], id: 's-new', name: 'Vanilla syrup', category: 'Syrup', count_unit_id: null, purchase_unit_id: null })
  live.signal('company:c1', 'supplies')
  await seen('Vanilla syrup').waitFor({ timeout: 3000 })
  await assertNoReload(page, 'new supply')
  checks.push('supplies list updates live')

  await seen('Whole milk').click()
  await page.getByRole('heading', { name: 'Whole milk' }).waitFor()
  await shot('22-supply-editor')
  await page.getByRole('button', { name: 'Close' }).last().click()

  await page.goto(`${base}/setup/products`)
  await seen('Latte').waitFor()
  await shot('23-products')
  await page.goto(`${base}/setup/products/p-latte`)
  await seen('Recipe for one large').waitFor()
  await shot('24-product-editor')

  await page.goto(`${base}/setup/addons`)
  await seen('Oat milk').waitFor()
  await seen('Swaps Whole milk for Oat milk').waitFor()
  checks.push('add on effects read back in plain words')
  await shot('25-addons')

  for (const [path, text, name] of [
    ['/setup/trucks', 'Coffee Van', '26-trucks'],
    ['/setup/locations', 'Storage unit B', '27-locations'],
    ['/setup/suppliers', 'Dairy Co', '28-suppliers'],
    ['/setup/lists', 'Waste reasons', '29-lists'],
    ['/setup/import', 'Download template', '30-import'],
    ['/settings', 'Manager count checks', '31-settings'],
  ]) {
    await page.goto(`${base}${path}`)
    await seen(text).waitFor()
    await shot(name)
  }
  checks.push('every setup screen opens')

  await context.close()
  return { checks, errors }
}

async function runShift(browser, size, label) {
  const { state, context, page, live, errors, shot, seen } = await openAsAdmin(browser, size, label)
  addShiftData(state)
  const checks = []
  const inputValue = (name) => page.getByLabel(name, { exact: true }).filter({ visible: true }).first().inputValue()
  const waitForValue = async (name, value) => {
    for (let i = 0; i < 30 && (await inputValue(name)) !== value; i++) await page.waitForTimeout(100)
    if ((await inputValue(name)) !== value) throw new Error(`${name} should show ${value}`)
  }

  // Jake, a driver, is the Lead on Truck 1.
  state.me.user_id = 'u-d1'
  state.me.profile = { full_name: 'Jake Turner', role: 'driver', active: true, phone: null, joined_at: '2026-10-03' }
  await page.goto(`${base}/`)
  await seen("You're on Truck 1").waitFor()
  await seen('Out now').waitFor()
  await shot('50-driver-home')

  await page.getByRole('button', { name: 'Continue shift' }).click()
  await seen('Lead: ').waitFor()
  await page.getByLabel('Ice amount', { exact: true }).waitFor()
  await shot('51-start-count')

  // Jake finds 2 fewer bags of ice than the app thought. It saves by itself.
  await page.getByLabel('Ice amount', { exact: true }).fill('6')
  for (let i = 0; i < 30 && !state.calls.includes('save_shift_counts'); i++) await page.waitForTimeout(100)
  if (!state.calls.includes('save_shift_counts')) throw new Error('Count was not saved')
  await seen('Different').waitFor()
  checks.push('counts save by themselves')

  // Maria (crew) counts cherry syrup on her phone. It shows on Jake's without a reload.
  await markPage(page)
  state.tables.shift_counts.push({ shift_id: 'sh-1', supply_id: 's-cherry', kind: 'start', quantity: 128, expected: null, photo_path: null, entered_by: 'u-m1', client_ts: new Date(Date.now() + 1000).toISOString() })
  live.signal('company:c1', 'shift_counts')
  await waitForValue('Cherry syrup amount', '1')
  await assertNoReload(page, 'crew count')
  checks.push("crew counts show up live on the Lead's phone")

  // No signal: the count waits on the phone, then sends when signal comes back.
  state.offline = true
  await context.setOffline(true)
  const before = state.calls.length
  await page.getByLabel('Small shaved ice cup amount', { exact: true }).fill('2')
  await seen('waiting for signal').waitFor({ timeout: 5000 })
  await shot('51b-no-signal')
  state.offline = false
  await context.setOffline(false)
  await page.getByText('waiting for signal').first().waitFor({ state: 'detached', timeout: 20000 })
  if (!state.calls.slice(before).includes('save_shift_counts')) throw new Error('Waiting count never sent')
  if (Number(state.tables.shift_counts.find((c) => c.supply_id === 's-cup-s')?.quantity) !== 100) throw new Error('Waiting count sent the wrong amount')
  checks.push('counts made with no signal send when it comes back')

  await page.getByRole('button', { name: 'Confirm starting count' }).click()
  await page.getByRole('button', { name: 'Tap again to confirm' }).click()
  await seen('Amounts are filled in to bring the truck back up').waitFor()
  checks.push('Lead confirms the start and moves on to loading')
  await shot('52-load')

  await page.getByRole('button', { name: 'Load these' }).click()
  await seen('Loaded on this shift').waitFor()
  await page.getByRole('button', { name: 'Generator fueled' }).click()
  await page.getByRole('button', { name: 'Generator fueled', pressed: true }).waitFor()
  checks.push('loading list fills from par levels and loads')
  await shot('53-loaded')

  await page.getByRole('navigation', { name: 'Shift steps' }).getByRole('button', { name: /Waste/ }).click()
  await page.getByRole('button', { name: 'Log waste' }).click()
  await page.getByLabel('Supply', { exact: true }).selectOption('s-cup-s')
  await page.getByLabel('How much was wasted').fill('1')
  await page.getByLabel('Why').selectOption({ label: 'Dropped' })
  await page.locator('input[type=file]').setInputFiles({ name: 'drop.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') })
  await page.getByAltText('Waste photo').waitFor()
  await shot('54-waste-sheet')
  await page.getByRole('button', { name: 'Log waste' }).last().click()
  await seen('Waste logged.').waitFor()
  if (!state.lastWaste?.photo_path?.startsWith('c1/waste/') || !state.uploads?.length) throw new Error('Waste photo was not uploaded')
  await seen('Small shaved ice cup: 1 sleeve').waitFor()
  checks.push('waste with a photo is logged')
  await shot('55-waste')

  await page.getByRole('button', { name: 'Start the ending count' }).click()
  await seen('To count').waitFor()
  for (const input of await page.getByLabel(/ amount$/).filter({ visible: true }).all()) await input.fill('1')
  await seen(/(\d+) of \1 counted/).waitFor()
  await shot('56-end-count')
  await page.getByRole('button', { name: 'Confirm ending count' }).click()
  await page.getByRole('button', { name: 'Tap again to confirm' }).click()
  await seen('Anything going back to the warehouse?').waitFor()
  await shot('57-finish')
  await page.getByRole('button', { name: 'Finish shift' }).click()
  await page.getByRole('button', { name: 'Tap again to finish' }).click()
  await seen("Here's what it used.").waitFor()
  checks.push('a whole shift runs from start to finish')
  await shot('58-results')

  // Maria, a manager, looks at shifts, waste, par levels, and flags.
  state.me.user_id = 'u-m1'
  state.me.profile = { full_name: 'Maria Lopez', role: 'manager', active: true, phone: null, joined_at: '2026-10-02' }
  await page.goto(`${base}/`)
  await seen('Needs a look').waitFor()
  await shot('59-manager-home')
  await page.getByRole('button', { name: 'Looks fine' }).click()
  await seen('Needs a look').waitFor({ state: 'detached' })
  checks.push('managers clear flags')
  await page.goto(`${base}/shifts`)
  await seen('Past shifts').waitFor()
  await seen('Ball game').waitFor()
  await shot('60-shifts')
  await page.goto(`${base}/shifts/sh-0?step=finish`)
  await seen('Syrups (any flavor) (all together)').waitFor()
  await shot('61-past-results')
  await page.goto(`${base}/inventory/waste`)
  await seen('Waste cost').waitFor()
  await shot('62-waste-page')
  await page.goto(`${base}/setup/pars`)
  await page.getByLabel('Large shaved ice cup par level').waitFor()
  await shot('63-pars')
  checks.push('manager shift, waste, and par screens open')

  await context.close()
  return { checks, errors }
}

async function runInventory(browser, size, label) {
  const { state, context, page, live, errors, shot, seen } = await openAsAdmin(browser, size, label)
  state.tables.profiles = state.people
  const checks = []

  await page.goto(`${base}/inventory`)
  await seen('Value on hand').waitFor()
  await seen('Expiring soon').waitFor()
  checks.push('low and expiring stock is marked')
  await shot('40-inventory')

  // A driver loads 2 sleeves of small cups onto Truck 1 from their phone.
  await markPage(page)
  const cups = state.tables.stock_levels.find((l) => l.place_id === 'loc-1' && l.supply_id === 's-cup-s')
  cups.quantity = 300
  live.signal('company:c1', 'stock_levels')
  await seen('6 sleeves').waitFor({ timeout: 3000 })
  await assertNoReload(page, 'stock change')
  checks.push('stock numbers update live')

  await seen('Whole milk').click()
  await seen('Expiration dates').waitFor()
  await shot('41-supply-stock')
  await page.getByRole('button', { name: 'Close' }).last().click()

  for (const [path, text, name] of [
    ['/inventory/receive', 'What came in', '42-receive'],
    ['/inventory/count?place=tr-1', 'Count stock', '43-count'],
    ['/inventory/move', "What's moving", '44-move'],
    ['/inventory/history', 'Stock history', '45-history'],
  ]) {
    await page.goto(`${base}${path}`)
    await seen(text).waitFor()
    await shot(name)
  }
  checks.push('every inventory screen opens')
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
    for (const flow of (process.env.FLOWS ? process.env.FLOWS.split(',').map((n) => ({ run, runSetup, runInventory, runShift })[n]) : [run, runSetup, runInventory, runShift])) {
      const { checks, errors } = await flow(browser, size, label)
      console.log(`${label} ${flow.name}: ${checks.length} checks passed: ${checks.join('; ')}`)
      if (errors.length) {
        failed = true
        console.log(`${label} page errors:`, errors)
      }
    }
  }
  await browser.close()
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error('FAILED', e)
  process.exit(1)
})
