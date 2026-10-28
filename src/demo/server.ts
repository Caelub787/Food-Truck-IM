// The demo's pretend Supabase. It answers the app's database, login, storage,
// and live update calls from memory, inside the browser. Nothing leaves the
// page, and everything resets on reload.
import { DEMO_COMPANY, people, seed, type Row } from './seed'

export const DEMO_URL = 'https://demo.truckstock.invalid'

let db = seed()
let userId = 'u-admin'
const photos = new Map<string, string>()
;(globalThis as { __demoPhotos?: Map<string, string> }).__demoPhotos = photos

const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const me = () => db.profiles!.find((p) => p.user_id === userId)!
const isDriver = () => me().role === 'driver'
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

// Live updates ------------------------------------------------------------------------------------

type Listener = (frame: string) => void
const sockets = new Set<Listener>()

/** Tells every open screen these tables changed (like the real database does). */
function signal(tables: string[]) {
  for (const table of new Set(tables)) {
    const frame = JSON.stringify([null, null, `realtime:company:${DEMO_COMPANY}`, 'broadcast', { type: 'broadcast', event: 'change', payload: { table, op: 'update' } }])
    for (const send of sockets) send(frame)
  }
}

/** Stands in for the browser's WebSocket for the demo's live connection. */
export class DemoSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = 0
  binaryType = 'arraybuffer'
  url: string
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  private listener: Listener = (frame) => this.onmessage?.({ data: frame })

  constructor(url: string) {
    this.url = url
    setTimeout(() => {
      this.readyState = 1
      sockets.add(this.listener)
      this.onopen?.({})
    }, 50)
  }
  send(raw: string) {
    let msg: unknown[]
    try {
      msg = JSON.parse(raw) as unknown[]
    } catch {
      return
    }
    const [joinRef, ref, topic, event] = msg
    if (event === 'phx_join' || event === 'heartbeat' || event === 'phx_leave' || event === 'access_token') {
      const response = event === 'phx_join' ? { postgres_changes: [] } : {}
      setTimeout(() => this.onmessage?.({ data: JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]) }), 10)
    }
  }
  close() {
    this.readyState = 3
    sockets.delete(this.listener)
    this.onclose?.({ code: 1000, reason: '' })
  }
  addEventListener() {}
  removeEventListener() {}
}

// Reading tables, PostgREST style ------------------------------------------------------------

function compare(a: unknown, b: string) {
  if (typeof a === 'number' || (a !== null && a !== '' && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b)) && !/^\d{4}-/.test(b))) return Number(a) - Number(b)
  return String(a ?? '').localeCompare(b)
}

function test(row: Row, column: string, expr: string): boolean {
  const dot = expr.indexOf('.')
  const op = expr.slice(0, dot)
  const value = decodeURIComponent(expr.slice(dot + 1))
  const v = row[column]
  switch (op) {
    case 'eq':
      return String(v) === value
    case 'neq':
      return String(v) !== value
    case 'in':
      return value.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v))
    case 'gte':
      return v !== null && v !== undefined && compare(v, value) >= 0
    case 'gt':
      return v !== null && v !== undefined && compare(v, value) > 0
    case 'lte':
      return v !== null && v !== undefined && compare(v, value) <= 0
    case 'lt':
      return v !== null && v !== undefined && compare(v, value) < 0
    case 'is':
      return value === 'null' ? v === null || v === undefined : String(v) === value
    case 'ilike':
      return new RegExp(`^${value.replace(/\*/g, '.*')}$`, 'i').test(String(v ?? ''))
    case 'not':
      return !test(row, column, value)
    default:
      return true
  }
}

const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

function matches(row: Row, params: URLSearchParams) {
  for (const [key, expr] of params) {
    if (reserved.has(key)) continue
    if (key === 'or') {
      const parts = expr.replace(/^\(|\)$/g, '').split(',')
      if (!parts.some((p) => test(row, p.slice(0, p.indexOf('.')), p.slice(p.indexOf('.') + 1)))) return false
    } else if (!test(row, key, expr)) return false
  }
  return true
}

// Drivers only see what's theirs, like the real security rules.
function visible(table: string, rows: Row[]) {
  if (!isDriver()) return rows
  const mine = new Set(db.shift_crew!.filter((c) => c.user_id === userId).map((c) => c.shift_id))
  const myPlans = new Set([
    ...db.schedules!.filter((s) => s.lead_id === userId).map((s) => s.id),
    ...db.schedule_crew!.filter((c) => c.user_id === userId).map((c) => c.schedule_id),
  ])
  switch (table) {
    case 'shifts':
      return rows.filter((r) => mine.has(r.id))
    case 'shift_crew':
    case 'shift_counts':
    case 'shift_results':
    case 'shift_checklist':
      return rows.filter((r) => mine.has(r.shift_id))
    case 'sales':
    case 'waste_logs':
    case 'stock_movements':
      return rows.filter((r) => r.shift_id && mine.has(r.shift_id))
    case 'schedules':
      return rows.filter((r) => myPlans.has(r.id))
    case 'schedule_crew':
      return rows.filter((r) => myPlans.has(r.schedule_id))
    case 'flags':
    case 'suppliers':
    case 'purchase_orders':
    case 'purchase_order_lines':
    case 'sales_imports':
    case 'item_mappings':
    case 'deliveries':
    case 'audit_log':
      return []
    default:
      return rows
  }
}

function select(table: string, params: URLSearchParams) {
  let rows = visible(table, db[table] ?? []).filter((r) => matches(r, params))
  const order = params.get('order')
  if (order) {
    const keys = order.split(',').map((o) => o.split('.'))
    rows = [...rows].sort((a, b) => {
      for (const [col, dir] of keys) {
        const x = a[col!]
        const y = b[col!]
        if (x === y) continue
        if (x === null || x === undefined) return 1
        if (y === null || y === undefined) return -1
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
        return dir === 'desc' ? -c : c
      }
      return 0
    })
  }
  const limit = Number(params.get('limit') ?? 0)
  return limit ? rows.slice(0, limit) : rows
}

// Defaults a new row would get from the database.
function withDefaults(table: string, row: Row): Row {
  const sample = db[table]?.[0] ?? {}
  return {
    ...(('id' in sample || !db[table]?.length) && !['truck_pars', 'notification_settings', 'company_settings'].includes(table) ? { id: id() } : {}),
    ...('active' in sample ? { active: true } : {}),
    ...('sort' in sample ? { sort: 0 } : {}),
    ...('created_at' in sample ? { created_at: now() } : {}),
    company_id: DEMO_COMPANY,
    ...row,
  }
}

async function tableRequest(req: Request, table: string, params: URLSearchParams): Promise<Response> {
  const single = (req.headers.get('Accept') ?? '').includes('vnd.pgrst.object')
  db[table] ??= []
  if (req.method === 'GET' || req.method === 'HEAD') {
    const rows = select(table, params)
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` } })
    return json(single ? (rows[0] ?? null) : rows)
  }
  if (isDriver() && !['notification_settings', 'push_subscriptions'].includes(table)) {
    return json({ message: 'new row violates row-level security policy' }, 403)
  }
  const body = req.method === 'DELETE' ? null : ((await req.json()) as Row | Row[])
  let changed: Row[] = []
  if (req.method === 'POST') {
    const conflict = params.get('on_conflict')?.split(',')
    for (const raw of Array.isArray(body) ? body : [body!]) {
      const existing = conflict ? db[table].find((r) => conflict.every((c) => c === 'company_id' || String(r[c]) === String(raw[c]))) : undefined
      if (existing) {
        Object.assign(existing, raw)
        changed.push(existing)
      } else {
        const row = withDefaults(table, raw)
        db[table].push(row)
        changed.push(row)
      }
    }
  } else if (req.method === 'PATCH') {
    changed = db[table].filter((r) => matches(r, params))
    for (const r of changed) Object.assign(r, body)
  } else if (req.method === 'DELETE') {
    changed = db[table].filter((r) => matches(r, params))
    db[table] = db[table].filter((r) => !changed.includes(r))
  }
  if (table === 'locations' || table === 'trucks') db.places = [...db.locations!.map((l) => ({ id: l.id, kind: 'location' })), ...db.trucks!.map((x) => ({ id: x.id, kind: 'truck' }))]
  signal([table])
  return json(single ? (changed[0] ?? null) : changed, req.method === 'POST' ? 201 : 200)
}

// Stock helpers -------------------------------------------------------------------------------------

function addLevel(place: string, supply: string, q: number) {
  const l = db.stock_levels!.find((x) => x.place_id === place && x.supply_id === supply)
  if (l) {
    l.quantity = Number(l.quantity) + q
    l.updated_at = now()
  } else db.stock_levels!.push({ place_id: place, supply_id: supply, quantity: q, updated_at: now() })
}
const levelOf = (place: string, supply: string) => Number(db.stock_levels!.find((x) => x.place_id === place && x.supply_id === supply)?.quantity ?? 0)
const supplyRow = (sid: string) => db.supplies!.find((s) => s.id === sid)

function move(kind: string, supply: string, quantity: number, from: string | null, to: string | null, extra: Row = {}) {
  if (!quantity) return
  db.stock_movements!.unshift({
    id: id(), supply_id: supply, quantity, kind, from_place_id: from, to_place_id: to, unit_cost: Number(supplyRow(supply)?.cost_per_base ?? 0),
    shift_id: null, reason: null, note: null, created_by: userId, created_at: now(), ...extra,
  })
  if (from) addLevel(from, supply, -quantity)
  if (to) addLevel(to, supply, quantity)
}

function setCount(place: string, supply: string, counted: number, kind: string, extra: Row = {}) {
  const diff = counted - levelOf(place, supply)
  if (diff > 0) move(kind, supply, diff, null, place, extra)
  else if (diff < 0) move(kind, supply, -diff, place, null, extra)
}

const shift = (sid: string) => db.shifts!.find((s) => s.id === sid)!
const STOCK = ['stock_levels', 'stock_movements', 'stock_batches']

function shiftSupplies(s: Row) {
  return new Set([
    ...db.stock_levels!.filter((l) => l.place_id === s.truck_id && Number(l.quantity) !== 0).map((l) => l.supply_id),
    ...db.shift_counts!.filter((c) => c.shift_id === s.id).map((c) => c.supply_id),
    ...db.stock_movements!.filter((m) => m.shift_id === s.id).map((m) => m.supply_id),
    ...db.truck_pars!.filter((p) => p.truck_id === s.truck_id && Number(p.par_quantity) > 0).map((p) => p.supply_id),
  ])
}

/** The usage math for a finished shift, simplified for the demo. */
function finishShift(s: Row) {
  db.shift_results = db.shift_results!.filter((r) => r.shift_id !== s.id)
  const count = (sid: string, kind: string) => Number(db.shift_counts!.find((c) => c.shift_id === s.id && c.supply_id === sid && c.kind === kind)?.quantity ?? 0)
  for (const sid of shiftSupplies(s)) {
    const moves = db.stock_movements!.filter((m) => m.shift_id === s.id && m.supply_id === sid)
    const added = moves.filter((m) => m.kind === 'load').reduce((a, m) => a + Number(m.quantity), 0) - moves.filter((m) => m.kind === 'return' && m.created_at <= s.end_confirmed_at).reduce((a, m) => a + Number(m.quantity), 0)
    const waste = moves.filter((m) => m.kind === 'waste').reduce((a, m) => a + Number(m.quantity), 0)
    const start = count(sid, 'start')
    const end = count(sid, 'end')
    const actual = start + added - end - waste
    db.shift_results!.push({ id: id(), shift_id: s.id, supply_id: sid, group_id: null, start_qty: start, added_qty: added, end_qty: end, waste_qty: waste, actual_qty: actual, expected_qty: null, diff_qty: null, unit_cost: Number(supplyRow(sid)?.cost_per_base ?? 0), flagged: false, flag_reason: null })
    if (actual > 0) move('usage', sid, actual, s.truck_id, null, { shift_id: s.id })
    else if (actual < 0) move('adjustment', sid, -actual, null, s.truck_id, { shift_id: s.id, reason: 'More left than started with' })
  }
  // Expected usage from the drinks sold (recipes, not counting add ons).
  const sales = db.sales!.filter((x) => x.shift_id === s.id)
  if (sales.length > 0) {
    for (const r of db.shift_results!.filter((x) => x.shift_id === s.id)) {
      let expected = 0
      let used = false
      for (const sale of sales) {
        const recipe = db.recipe_versions!.filter((v) => v.product_size_id === sale.product_size_id).at(-1)
        for (const line of recipe?.recipe_lines ?? []) {
          if (line.supply_id === r.supply_id) {
            const unit = db.supply_units!.find((u) => u.id === line.unit_id)
            expected += Number(line.quantity) * Number(unit?.factor ?? 1) * Number(sale.quantity)
            used = true
          }
        }
      }
      if (!used) continue
      const diff = Number(r.actual_qty) - expected
      const pct = expected ? (Math.abs(diff) / expected) * 100 : 100
      Object.assign(r, { expected_qty: expected, diff_qty: diff, flagged: pct >= 10 && Math.abs(diff) * Number(r.unit_cost) >= 2 })
    }
  }
  s.status = 'closed'
  s.ended_at = now()
  const checks = db.company_settings![0]!.count_checks_enabled && db.shift_results!.some((r) => r.shift_id === s.id && supplyRow(r.supply_id)?.count_check)
  s.count_check_status = checks ? 'waiting' : 'not_needed'
}

// Database functions ------------------------------------------------------------------------------

type P = Row
const rpcs: Record<string, (a: P) => [unknown, string[]?]> = {
  my_context: () => {
    const c = db.companies![0]!
    const p = me()
    return [{ user_id: userId, email: p.email, is_owner: false, profile: { full_name: p.full_name, role: p.role, active: p.active, phone: p.phone, joined_at: p.joined_at }, company: { id: c.id, name: c.name, status: c.status, phone: c.phone, timezone: c.timezone, status_reason: null } }]
  },
  setup_progress: () => [{ locations: db.locations!.length, trucks: db.trucks!.length, suppliers: db.suppliers!.length, supplies: db.supplies!.length, products: db.products!.length, recipes: db.recipe_versions!.length, people: db.profiles!.length }],
  mark_joined: () => [null],
  update_my_profile: ({ p_full_name, p_phone }) => {
    Object.assign(me(), { full_name: p_full_name, phone: p_phone })
    return [null, ['profiles']]
  },
  update_member: ({ p_user_id, p_full_name, p_role, p_phone }) => {
    Object.assign(db.profiles!.find((p) => p.user_id === p_user_id)!, { full_name: p_full_name, role: p_role, phone: p_phone })
    return [null, ['profiles']]
  },
  set_member_active: ({ p_user_id, p_active }) => {
    db.profiles!.find((p) => p.user_id === p_user_id)!.active = p_active
    return [null, ['profiles']]
  },

  // Setup
  save_supply: ({ p }) => {
    let s = p.id ? supplyRow(p.id) : undefined
    if (!s) {
      s = withDefaults('supplies', { id: id(), name: p.name })
      db.supplies!.push(s)
    }
    const sid = s.id as string
    db.supply_units = db.supply_units!.filter((u) => u.supply_id !== sid)
    for (const u of p.units ?? []) db.supply_units!.push({ id: u.id ?? id(), supply_id: sid, name: u.name, factor: u.factor })
    const unitId = (name: string) => (name ? db.supply_units!.find((u) => u.supply_id === sid && u.name === name)?.id ?? null : null)
    const { units: _units, count_unit, purchase_unit, ...fields } = p
    Object.assign(s, fields, { id: sid, count_unit_id: unitId(count_unit), purchase_unit_id: unitId(purchase_unit), supplier_id: p.supplier_id || null, truck_type_id: p.truck_type_id || null, group_id: p.group_id || null })
    return [sid, ['supplies', 'supply_units']]
  },
  save_recipe: ({ p_product_size_id, p_lines }) => {
    const v = { id: id(), product_size_id: p_product_size_id, effective_from: now(), note: null, recipe_lines: p_lines }
    db.recipe_versions!.push(v)
    return [v.id, ['recipe_versions', 'recipe_lines']]
  },
  save_modifier_effects: ({ p_modifier_id, p_effects }) => {
    db.modifier_versions!.push({ id: id(), modifier_id: p_modifier_id, effective_from: now(), modifier_effects: p_effects })
    return [null, ['modifier_versions', 'modifier_effects']]
  },
  import_supplies: ({ p_rows }) => {
    let created = 0
    for (const r of p_rows as Row[]) {
      if (!r.name || db.supplies!.some((s) => s.name.toLowerCase() === String(r.name).toLowerCase())) continue
      db.supplies!.push(withDefaults('supplies', { id: id(), name: r.name, category: r.category ?? null, base_unit: r.base_unit || 'each', cost_per_base: 0, count_unit_id: null, purchase_unit_id: null }))
      created++
    }
    return [{ created, updated: 0, errors: [] }, ['supplies']]
  },
  import_products: () => [{ created: 0, updated: 0, errors: [{ row: 1, name: 'Demo', message: 'Product import is turned off in the demo.' }] }],

  // Stock
  receive_delivery: ({ p }) => {
    for (const l of p.lines) {
      move('delivery', l.supply_id, Number(l.quantity), null, p.location_id)
      if (l.unit_cost != null) supplyRow(l.supply_id)!.cost_per_base = l.unit_cost
    }
    if (p.purchase_order_id) Object.assign(db.purchase_orders!.find((o) => o.id === p.purchase_order_id) ?? {}, { status: 'received', received_at: now() })
    return [id(), [...STOCK, 'supplies', 'deliveries', 'purchase_orders']]
  },
  record_count: ({ p }) => {
    for (const l of p.lines) setCount(p.place_id, l.supply_id, Number(l.counted), 'adjustment', { reason: 'Count' })
    return [id(), STOCK]
  },
  transfer_stock: ({ p }) => {
    const kind = db.trucks!.some((t) => t.id === p.to_place_id) ? 'load' : db.trucks!.some((t) => t.id === p.from_place_id) ? 'return' : 'transfer'
    for (const l of p.lines) move(kind, l.supply_id, Number(l.quantity), p.from_place_id, p.to_place_id, { note: p.note || null })
    return [p.lines.length, STOCK]
  },
  adjust_stock: ({ p_place_id, p_supply_id, p_quantity, p_reason }) => {
    const q = Number(p_quantity)
    move('adjustment', p_supply_id, Math.abs(q), q < 0 ? p_place_id : null, q < 0 ? null : p_place_id, { reason: p_reason })
    return [null, STOCK]
  },
  set_batch_expiration: ({ p_batch_id, p_expires_on }) => {
    Object.assign(db.stock_batches!.find((b) => b.id === p_batch_id) ?? {}, { expires_on: p_expires_on })
    return [null, ['stock_batches']]
  },

  // Shifts
  open_shifts: () => [db.shifts!.filter((s) => s.status === 'open').map((s) => ({ shift_id: s.id, truck_id: s.truck_id, lead_id: s.lead_id, started_at: s.started_at, start_confirmed: Boolean(s.start_confirmed_at) }))],
  start_shift: ({ p }) => {
    if (db.shifts!.some((s) => s.truck_id === p.truck_id && s.status === 'open')) throw new Error('This truck already has a shift going. Join it instead.')
    const s = { id: id(), truck_id: p.truck_id, lead_id: p.lead_id, status: 'open', business_date: now().slice(0, 10), event_name: p.event_name || null, notes: null, schedule_id: p.schedule_id ?? null, started_at: now(), start_confirmed_at: null, checklist_done_at: null, end_confirmed_at: null, ended_at: null, count_check_status: 'not_needed' }
    db.shifts!.unshift(s)
    db.shift_crew!.push({ shift_id: s.id, user_id: p.lead_id, role: 'lead' })
    const crew = new Set<string>([...(p.crew_ids ?? []), ...(isDriver() ? [userId] : [])])
    for (const u of crew) if (u !== p.lead_id) db.shift_crew!.push({ shift_id: s.id, user_id: u, role: 'crew' })
    for (const sc of db.shifts!) if (sc.truck_id === p.truck_id && sc.count_check_status === 'waiting') sc.count_check_status = 'missed'
    return [s.id, ['shifts', 'shift_crew']]
  },
  join_shift: ({ p_shift_id }) => {
    if (!db.shift_crew!.some((c) => c.shift_id === p_shift_id && c.user_id === userId)) db.shift_crew!.push({ shift_id: p_shift_id, user_id: userId, role: 'crew' })
    return [null, ['shift_crew', 'shifts']]
  },
  set_shift_crew: ({ p_shift_id, p_lead_id, p_crew_ids }) => {
    db.shift_crew = db.shift_crew!.filter((c) => c.shift_id !== p_shift_id)
    db.shift_crew.push({ shift_id: p_shift_id, user_id: p_lead_id, role: 'lead' })
    for (const u of p_crew_ids) if (u !== p_lead_id) db.shift_crew.push({ shift_id: p_shift_id, user_id: u, role: 'crew' })
    shift(p_shift_id).lead_id = p_lead_id
    return [null, ['shift_crew', 'shifts']]
  },
  cancel_shift: ({ p_shift_id }) => {
    Object.assign(shift(p_shift_id), { status: 'cancelled', ended_at: now() })
    return [null, ['shifts']]
  },
  save_shift_counts: ({ p }) => {
    for (const l of p.lines) {
      const existing = db.shift_counts!.find((c) => c.shift_id === p.shift_id && c.supply_id === l.supply_id && c.kind === p.kind)
      if (existing && existing.client_ts > l.client_ts) continue
      db.shift_counts = db.shift_counts!.filter((c) => c !== existing)
      if (l.quantity !== null) db.shift_counts.push({ shift_id: p.shift_id, supply_id: l.supply_id, kind: p.kind, quantity: l.quantity, expected: null, photo_path: null, entered_by: userId, client_ts: l.client_ts })
    }
    return [null, ['shift_counts']]
  },
  confirm_shift_start: ({ p_shift_id }) => {
    const s = shift(p_shift_id)
    for (const sid of shiftSupplies(s)) {
      const expected = levelOf(s.truck_id, sid)
      const c = db.shift_counts!.find((x) => x.shift_id === s.id && x.supply_id === sid && x.kind === 'start')
      if (c) {
        c.expected = expected
        setCount(s.truck_id, sid, Number(c.quantity), 'adjustment', { shift_id: s.id, reason: 'Starting count' })
      } else db.shift_counts!.push({ shift_id: s.id, supply_id: sid, kind: 'start', quantity: Math.max(expected, 0), expected, photo_path: null, entered_by: null, client_ts: now() })
    }
    s.start_confirmed_at = now()
    return [null, ['shifts', 'shift_counts', ...STOCK]]
  },
  load_truck: ({ p }) => {
    const s = shift(p.shift_id)
    for (const l of p.lines) move('load', l.supply_id, Number(l.quantity), p.location_id, s.truck_id, { shift_id: s.id })
    return [p.lines.length, STOCK]
  },
  return_from_truck: ({ p }) => {
    const s = shift(p.shift_id)
    for (const l of p.lines) move('return', l.supply_id, Number(l.quantity), s.truck_id, p.location_id, { shift_id: s.id })
    return [p.lines.length, STOCK]
  },
  set_checklist_item: ({ p_shift_id, p_item_id, p_checked }) => {
    db.shift_checklist = db.shift_checklist!.filter((c) => !(c.shift_id === p_shift_id && c.item_id === p_item_id))
    if (p_checked) db.shift_checklist.push({ shift_id: p_shift_id, item_id: p_item_id, checked_by: userId })
    return [null, ['shift_checklist']]
  },
  finish_checklist: ({ p_shift_id }) => {
    shift(p_shift_id).checklist_done_at = now()
    return [null, ['shifts']]
  },
  log_waste: ({ p }) => {
    const place = p.shift_id ? shift(p.shift_id).truck_id : p.place_id
    const wid = id()
    let cost = 0
    if (p.supply_id) {
      move('waste', p.supply_id, Number(p.quantity), place, null, { shift_id: p.shift_id ?? null, waste_log_id: wid })
      cost = Number(p.quantity) * Number(supplyRow(p.supply_id)?.cost_per_base ?? 0)
    }
    db.waste_logs!.unshift({ id: wid, place_id: place, shift_id: p.shift_id ?? null, supply_id: p.supply_id ?? null, product_size_id: p.product_size_id ?? null, modifier_ids: p.modifier_ids ?? [], quantity: p.quantity, reason_id: p.reason_id, note: p.note || null, photo_path: p.photo_path ?? null, cost, created_by: userId, created_at: now() })
    return [wid, ['waste_logs', 'waste_lines', ...STOCK]]
  },
  confirm_shift_end: ({ p_shift_id }) => {
    shift(p_shift_id).end_confirmed_at = now()
    return [null, ['shifts']]
  },
  finish_shift: ({ p_shift_id }) => {
    finishShift(shift(p_shift_id))
    return [null, ['shifts', 'shift_results', 'flags', ...STOCK]]
  },
  review_flag: ({ p_flag_id, p_note }) => {
    Object.assign(db.flags!.find((f) => f.id === p_flag_id)!, { status: 'reviewed', reviewed_by: userId, reviewed_at: now(), review_note: p_note })
    return [null, ['flags']]
  },

  // Sales
  save_sales_tally: ({ p }) => {
    const s = shift(p.shift_id)
    const source = isDriver() ? 'driver' : 'manager'
    for (const l of p.lines) {
      const ref = `${s.id}:${l.key}`
      db.sales = db.sales!.filter((x) => !(x.source === source && x.source_ref === ref))
      const size = db.product_sizes!.find((x) => x.id === l.product_size_id)
      if (l.quantity > 0) {
        db.sales.push({ id: id(), truck_id: s.truck_id, shift_id: s.id, sold_at: s.started_at, product_size_id: l.product_size_id, modifier_ids: l.modifier_ids ?? [], quantity: l.quantity, price: l.is_free ? 0 : l.quantity * Number(size?.price ?? 0), is_free: l.is_free, free_reason_id: l.free_reason_id ?? null, source, source_ref: ref, outside_name: null, import_id: null, client_ts: l.client_ts })
      }
    }
    return [null, ['sales']]
  },
  ingest_sales: ({ p }) => {
    for (const m of p.mappings ?? []) {
      db.item_mappings = db.item_mappings!.filter((x) => !(x.kind === m.kind && x.outside_key === m.outside_key))
      db.item_mappings.push({ id: id(), source: 'csv', ...m })
    }
    if (!db.sales_imports!.some((i) => i.id === p.import_id)) {
      db.sales_imports!.unshift({ id: p.import_id, source: 'csv', file_name: p.file_name, rows_added: 0, rows_duplicate: 0, rows_ignored: 0, rows_unmatched: 0, rows_no_shift: 0, unmatched_names: [], undone_at: null, created_by: userId, created_at: now() })
    }
    const imp = db.sales_imports!.find((i) => i.id === p.import_id)!
    const r = { import_id: p.import_id, added: 0, duplicates: 0, ignored: 0, unmatched: 0, no_shift: 0, unmatched_names: [] as string[] }
    for (const row of p.rows as Row[]) {
      const map = db.item_mappings!.find((x) => x.kind === 'item' && x.outside_key === row.item_key)
      if (map?.ignore) {
        r.ignored++
        continue
      }
      if (!map?.product_size_id) {
        r.unmatched++
        r.unmatched_names.push(row.item_name)
        continue
      }
      if (db.sales!.some((x) => x.source === 'csv' && x.source_ref === row.ref)) {
        r.duplicates++
        continue
      }
      const truck = p.truck_id ?? db.item_mappings!.find((x) => x.kind === 'truck' && x.outside_key === String(row.truck_key ?? '').toLowerCase())?.truck_id
      const at = row.sold_at ?? new Date(String(row.sold_local).replace(' ', 'T')).toISOString()
      const sh = db.shifts!.find((s) => s.truck_id === truck && s.started_at <= at && (!s.ended_at || at <= s.ended_at))
      if (!sh) r.no_shift++
      db.sales!.push({ id: id(), truck_id: truck, shift_id: sh?.id ?? null, sold_at: at, product_size_id: map.product_size_id, modifier_ids: [], quantity: row.quantity, price: row.price ?? 0, is_free: row.is_free, free_reason_id: null, source: 'csv', source_ref: row.ref, outside_name: row.item_name, import_id: p.import_id, client_ts: now() })
      r.added++
    }
    imp.rows_added += r.added
    imp.rows_duplicate += r.duplicates
    imp.rows_no_shift += r.no_shift
    r.unmatched_names = [...new Set(r.unmatched_names)]
    return [r, ['sales', 'sales_imports', 'item_mappings']]
  },
  undo_sales_import: ({ p_import_id }) => {
    Object.assign(db.sales_imports!.find((i) => i.id === p_import_id)!, { undone_at: now() })
    db.sales = db.sales!.filter((x) => x.import_id !== p_import_id)
    return [1, ['sales', 'sales_imports']]
  },
  record_count_check: ({ p }) => {
    const s = shift(p.shift_id)
    for (const l of p.lines) {
      db.shift_counts = db.shift_counts!.filter((c) => !(c.shift_id === s.id && c.supply_id === l.supply_id && c.kind === 'check'))
      db.shift_counts.push({ shift_id: s.id, supply_id: l.supply_id, kind: 'check', quantity: l.quantity, expected: null, photo_path: null, entered_by: userId, client_ts: now() })
      setCount(s.truck_id, l.supply_id, Number(l.quantity), 'correction', { shift_id: s.id, reason: 'Manager count check' })
    }
    s.count_check_status = 'done'
    return [null, ['shifts', 'shift_counts', 'shift_results', ...STOCK]]
  },

  // Plans, orders, par levels
  save_schedule: ({ p }) => {
    const sid = p.id ?? id()
    const weeks = p.id ? 0 : Number(p.repeat_weeks ?? 0)
    const series = weeks > 0 ? id() : null
    db.schedules = db.schedules!.filter((x) => x.id !== sid)
    db.schedule_crew = db.schedule_crew!.filter((c) => c.schedule_id !== sid)
    for (let i = 0; i <= weeks; i++) {
      const one = i === 0 ? sid : id()
      const shiftBy = (iso: string) => new Date(Date.parse(iso) + i * 7 * 86400000).toISOString()
      db.schedules.push({ id: one, truck_id: p.truck_id, starts_at: shiftBy(p.starts_at), ends_at: shiftBy(p.ends_at), event_name: p.event_name || null, place: p.place || null, notes: p.notes || null, lead_id: p.lead_id, status: 'planned', series_id: series })
      for (const u of p.crew_ids ?? []) db.schedule_crew.push({ schedule_id: one, user_id: u })
    }
    return [sid, ['schedules', 'schedule_crew']]
  },
  cancel_schedule: ({ p_schedule_id, p_and_later }) => {
    const s = db.schedules!.find((x) => x.id === p_schedule_id)!
    for (const x of db.schedules!) if (x.id === s.id || (p_and_later && s.series_id && x.series_id === s.series_id && x.starts_at >= s.starts_at)) x.status = 'cancelled'
    return [1, ['schedules']]
  },
  build_order_lists: () => [db.purchase_orders!.filter((o) => o.status === 'draft').length],
  save_purchase_order: ({ p }) => {
    db.purchase_order_lines = db.purchase_order_lines!.filter((l) => l.order_id !== p.order_id)
    for (const l of p.lines) if (l.quantity > 0) db.purchase_order_lines.push({ order_id: p.order_id, supply_id: l.supply_id, quantity: l.quantity, unit_cost: Number(supplyRow(l.supply_id)?.cost_per_base ?? 0) })
    db.purchase_orders!.find((o) => o.id === p.order_id)!.edited = true
    return [null, ['purchase_orders', 'purchase_order_lines']]
  },
  approve_purchase_order: ({ p_order_id }) => {
    const o = db.purchase_orders!.find((x) => x.id === p_order_id)!
    const email = db.suppliers!.find((s) => s.id === o.supplier_id)?.order_method === 'email'
    Object.assign(o, { status: email ? 'sent' : 'approved', approved_at: now(), sent_at: email ? now() : null })
    return [o.status, ['purchase_orders']]
  },
  set_purchase_order_status: ({ p_order_id, p_status }) => {
    db.purchase_orders!.find((o) => o.id === p_order_id)!.status = p_status
    return [null, ['purchase_orders']]
  },
  apply_par_suggestions: ({ p_truck_id }) => {
    let n = 0
    for (const sg of db.par_suggestions!.filter((x) => x.truck_id === p_truck_id)) {
      const par = db.truck_pars!.find((x) => x.truck_id === sg.truck_id && x.supply_id === sg.supply_id)
      if (par) par.par_quantity = sg.suggested_qty
      else db.truck_pars!.push({ truck_id: sg.truck_id, supply_id: sg.supply_id, par_quantity: sg.suggested_qty, low_quantity: null })
      n++
    }
    return [n, ['truck_pars']]
  },
  save_push_subscription: () => [null],
}

// Login ----------------------------------------------------------------------------------------------

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** A logged in session for whoever the demo is showing. */
export function demoSession() {
  const p = me()
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24
  const user = { id: userId, email: p.email, aud: 'authenticated', role: 'authenticated', user_metadata: { full_name: p.full_name }, app_metadata: {}, email_confirmed_at: now(), created_at: now() }
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId, email: p.email, role: 'authenticated', aud: 'authenticated', exp })}.demo`
  return { access_token: token, token_type: 'bearer', expires_in: 86400, expires_at: exp, refresh_token: `demo-${userId}`, user }
}

// The fetch the app uses in the demo ---------------------------------------------------------------

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  await new Promise((r) => setTimeout(r, 60)) // a little delay, like a real connection

  if (path === '/auth/v1/token') {
    if (url.searchParams.get('grant_type') === 'password') {
      const body = (await req.json()) as { email?: string }
      const p = people.find((x) => x.email === body.email?.toLowerCase())
      if (p) userId = p.user_id
    }
    return json(demoSession())
  }
  if (path === '/auth/v1/user') return json(demoSession().user)
  if (path === '/auth/v1/logout') return new Response(null, { status: 204 })
  if (path.startsWith('/auth/v1/')) return json({ msg: "That isn't part of the demo. Set up the real app to sign up.", error_code: 'demo' }, 400)

  if (path.startsWith('/rest/v1/rpc/')) {
    const fn = rpcs[path.slice('/rest/v1/rpc/'.length)]
    const args = (req.method === 'GET' ? {} : await req.json().catch(() => ({}))) as P
    if (!fn) return json(null)
    try {
      const [result, tables] = fn(args ?? {})
      if (tables?.length) signal(tables)
      return json(result ?? null)
    } catch (e) {
      return json({ message: e instanceof Error ? e.message : String(e), code: 'P0001' }, 400)
    }
  }
  if (path.startsWith('/rest/v1/')) return tableRequest(req, path.slice('/rest/v1/'.length), url.searchParams)

  if (path.startsWith('/storage/v1/object/sign/')) return json({ signedURL: `${path.slice('/storage/v1'.length)}?token=demo` })
  if (path.startsWith('/storage/v1/object/photos/')) {
    const key = decodeURIComponent(path.slice('/storage/v1/object/photos/'.length))
    const blob = await req.blob()
    const reader = new FileReader()
    photos.set(key, await new Promise<string>((resolve) => {
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(blob)
    }))
    return json({ Key: `photos/${key}`, Id: id() })
  }
  if (path === '/functions/v1/manage-invite') {
    const body = (await req.json()) as Row
    if (body.action === 'cancel') db.profiles = db.profiles!.filter((p) => p.user_id !== body.user_id)
    else if (!db.profiles!.some((p) => p.email === body.email)) {
      db.profiles!.push({ user_id: id(), company_id: DEMO_COMPANY, full_name: body.full_name, email: body.email, phone: null, role: body.role, active: true, invited_at: now(), joined_at: null })
    }
    signal(['profiles'])
    return json({ ok: true, action: body.action === 'cancel' ? 'cancelled' : 'invited' })
  }
  return json({ message: 'Not part of the demo.' }, 404)
}

/** Swaps in the demo's pretend server for the app's network calls. Call before the app loads. */
export function installDemo() {
  const realFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    return req.url.startsWith(DEMO_URL) ? handle(req) : realFetch(input, init)
  }
  const RealSocket = globalThis.WebSocket
  globalThis.WebSocket = function (url: string | URL, protocols?: string | string[]) {
    if (String(url).includes('demo.truckstock.invalid')) return new DemoSocket(String(url))
    return new RealSocket(url, protocols)
  } as unknown as typeof WebSocket
  Object.assign(globalThis.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
}

/** The demo banner's "view as" switch. */
export function switchUser(next: string) {
  userId = next
}
export const currentUser = () => userId

/** Starts over with fresh sample data. */
export function resetDemo() {
  db = seed()
  signal(Object.keys(db))
}
