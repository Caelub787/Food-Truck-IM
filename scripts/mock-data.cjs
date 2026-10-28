// Sample business data for the fake Supabase in phone-screens.cjs.

function setupTables() {
  const t = {
    company_settings: [
      {
        company_id: 'c1', scheduling_enabled: false, count_checks_enabled: true, count_check_blind: true, count_check_manager_wins: true,
        expiration_tracking: true, loading_checklist_enabled: true, sales_reporters: 'drivers', sales_source_order: ['file', 'manager', 'driver'],
        diff_percent: 10, diff_min_dollars: 2, shift_dollar_limit: 25, par_cushion_percent: 25, par_lookback_shifts: 10, par_auto_update: false,
        expiration_warning_days: 3, morning_hour: 6, daily_report_hour: 20, weekly_report_day: 1, summary_hour: 7, start_reminder_minutes: 30,
        shift_reminder_hours: 12, shift_alert_hours: 16, count_check_reminder_hours: 18, waste_pattern_factor: 1.5, photo_retention_days: 180,
      },
    ],
    locations: [
      { id: 'loc-1', name: 'Warehouse', kind: 'warehouse', address: '12 Dock Rd', active: true },
      { id: 'loc-2', name: 'Storage unit B', kind: 'storage', address: null, active: true },
    ],
    truck_types: [
      { id: 'tt-ice', name: 'Shaved ice', active: true },
      { id: 'tt-coffee', name: 'Coffee', active: true },
    ],
    trucks: [
      { id: 'tr-1', name: 'Truck 1', truck_type_id: 'tt-ice', home_location_id: 'loc-1', notes: null, active: true },
      { id: 'tr-2', name: 'Truck 2', truck_type_id: 'tt-ice', home_location_id: 'loc-1', notes: null, active: true },
      { id: 'tr-3', name: 'Coffee Van', truck_type_id: 'tt-coffee', home_location_id: 'loc-1', notes: null, active: true },
    ],
    suppliers: [
      { id: 'sup-1', name: 'Dairy Co', contact_name: 'Lee', email: 'orders@dairy.example', phone: '555 0300', order_method: 'email', order_days: 'Tue for Thu', minimum_order: 50, notes: null, active: true },
      { id: 'sup-2', name: 'Paper Supply', contact_name: null, email: null, phone: '555 0400', order_method: 'self', order_days: null, minimum_order: null, notes: null, active: true },
    ],
    supply_groups: [{ id: 'grp-syrup', name: 'Syrups (any flavor)', base_unit: 'oz', active: true }],
    supplies: [],
    supply_units: [],
    products: [
      { id: 'p-ice', name: 'Shaved ice', category: 'Shaved ice', truck_type_id: 'tt-ice', active: true, sort: 0 },
      { id: 'p-latte', name: 'Latte', category: 'Espresso drinks', truck_type_id: 'tt-coffee', active: true, sort: 1 },
    ],
    product_sizes: [
      { id: 'ps-ice-s', product_id: 'p-ice', name: 'Small', price: 4, active: true, sort: 0 },
      { id: 'ps-ice-l', product_id: 'p-ice', name: 'Large', price: 6, active: true, sort: 1 },
      { id: 'ps-latte-m', product_id: 'p-latte', name: 'Medium', price: 5, active: true, sort: 0 },
      { id: 'ps-latte-l', product_id: 'p-latte', name: 'Large', price: 5.5, active: true, sort: 1 },
    ],
    modifier_groups: [{ id: 'mg-milk', name: 'Milk', active: true, sort: 0 }],
    modifiers: [{ id: 'm-oat', group_id: 'mg-milk', name: 'Oat milk', price: 0.75, active: true, sort: 0 }],
    product_modifier_groups: [{ product_id: 'p-latte', group_id: 'mg-milk' }],
    recipe_versions: [],
    modifier_versions: [],
    waste_reasons: ['Spilled', 'Dropped', 'Expired', 'Melted'].map((name, i) => ({ id: `wr-${i}`, name, active: true, sort: i })),
    free_reasons: ['Drop replacement', 'Giveaway or promo', 'Employee drink'].map((name, i) => ({ id: `fr-${i}`, name, active: true, sort: i })),
    checklist_items: ['Generator fueled', 'Cash bank counted', 'Card reader charged'].map((name, i) => ({ id: `ck-${i}`, name, truck_type_id: null, active: true, sort: i })),
  }

  const supply = (id, name, category, base, units, count, extra = {}) => {
    t.supplies.push({
      id, name, category, base_unit: base, count_unit_id: count ? `${id}-${count}` : null, purchase_unit_id: units.length > 1 ? `${id}-${units[units.length - 1][0]}` : null,
      supplier_id: null, truck_type_id: null, group_id: null, cost_per_base: 0, reorder_level: null, order_up_to: null, whole_only: false,
      tracks_expiration: false, shelf_life_days: null, count_check: false, diff_percent: null, diff_min_qty: null, notes: null, active: true, ...extra,
    })
    for (const [unit, factor] of units) t.supply_units.push({ id: `${id}-${unit}`, supply_id: id, name: unit, factor })
  }
  supply('s-milk', 'Whole milk', 'Milk', 'oz', [['half gallon', 64], ['case', 384]], 'half gallon', { supplier_id: 'sup-1', cost_per_base: 0.05, reorder_level: 256, order_up_to: 768, tracks_expiration: true, shelf_life_days: 10, truck_type_id: 'tt-coffee' })
  supply('s-oat', 'Oat milk', 'Milk', 'oz', [['half gallon', 64], ['case', 384]], 'half gallon', { supplier_id: 'sup-1', cost_per_base: 0.0625, truck_type_id: 'tt-coffee' })
  supply('s-beans', 'Espresso beans', 'Coffee', 'g', [['shot', 9], ['bag', 2268]], 'bag', { cost_per_base: 0.024, truck_type_id: 'tt-coffee' })
  supply('s-cherry', 'Cherry syrup', 'Syrup', 'oz', [['gallon', 128], ['case', 512]], 'gallon', { group_id: 'grp-syrup', cost_per_base: 0.117, truck_type_id: 'tt-ice' })
  supply('s-blue', 'Blue raspberry syrup', 'Syrup', 'oz', [['gallon', 128], ['case', 512]], 'gallon', { group_id: 'grp-syrup', cost_per_base: 0.117, truck_type_id: 'tt-ice' })
  supply('s-cup-s', 'Small shaved ice cup', 'Cups', 'each', [['sleeve', 50], ['case', 1000]], 'sleeve', { supplier_id: 'sup-2', cost_per_base: 0.045, count_check: true, reorder_level: 500, truck_type_id: 'tt-ice' })
  supply('s-cup-l', 'Large shaved ice cup', 'Cups', 'each', [['sleeve', 50], ['case', 1000]], 'sleeve', { supplier_id: 'sup-2', cost_per_base: 0.06, count_check: true, truck_type_id: 'tt-ice' })
  supply('s-ice', 'Ice', 'Ice', 'lb', [['bag', 10]], 'bag', { cost_per_base: 0.3, truck_type_id: 'tt-ice' })

  const recipe = (id, sizeId, lines) =>
    t.recipe_versions.push({ id, product_size_id: sizeId, effective_from: '2026-10-01T12:00:00Z', note: null, recipe_lines: lines })
  recipe('rv-1', 'ps-ice-s', [
    { supply_id: 's-cup-s', group_id: null, quantity: 1, unit_id: null },
    { supply_id: 's-ice', group_id: null, quantity: 0.4, unit_id: null },
    { supply_id: null, group_id: 'grp-syrup', quantity: 2, unit_id: null },
  ])
  recipe('rv-2', 'ps-latte-l', [
    { supply_id: 's-beans', group_id: null, quantity: 27, unit_id: 's-beans-shot' },
    { supply_id: 's-milk', group_id: null, quantity: 14, unit_id: null },
  ])
  t.stock_levels = [
    ['loc-1', 's-milk', 900], ['loc-1', 's-oat', 200], ['loc-1', 's-beans', 9072], ['loc-1', 's-cherry', 1024], ['loc-1', 's-blue', 128],
    ['loc-1', 's-cup-s', 400], ['loc-1', 's-cup-l', 3000], ['loc-1', 's-ice', 400],
    ['tr-1', 's-cherry', 256], ['tr-1', 's-cup-s', 150], ['tr-1', 's-ice', 80],
  ].map(([place_id, supply_id, quantity]) => ({ place_id, supply_id, quantity, updated_at: '2026-10-28T12:00:00Z' }))
  const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  t.stock_batches = [
    { id: 'b-1', place_id: 'loc-1', supply_id: 's-milk', expires_on: soon, received_on: '2026-10-20', quantity: 384 },
    { id: 'b-2', place_id: 'loc-1', supply_id: 's-milk', expires_on: '2026-11-20', received_on: '2026-10-27', quantity: 516 },
  ]
  t.stock_movements = [
    { id: 'mv-a', supply_id: 's-milk', quantity: 384, kind: 'delivery', from_place_id: null, to_place_id: 'loc-1', unit_cost: 0.05, shift_id: null, reason: null, note: null, created_by: 'u-m1', created_at: '2026-10-27T09:00:00Z' },
    { id: 'mv-b', supply_id: 's-cup-s', quantity: 150, kind: 'load', from_place_id: 'loc-1', to_place_id: 'tr-1', unit_cost: 0.045, shift_id: null, reason: null, note: null, created_by: 'u-d1', created_at: '2026-10-28T08:00:00Z' },
    { id: 'mv-c', supply_id: 's-ice', quantity: 20, kind: 'adjustment', from_place_id: 'loc-1', to_place_id: null, unit_cost: 0.3, shift_id: null, reason: 'Count', note: null, created_by: 'u-admin', created_at: '2026-10-28T10:00:00Z' },
  ]
  t.deliveries = []
  t.profiles = []
  t.modifier_versions.push({ id: 'mv-1', modifier_id: 'm-oat', effective_from: '2026-10-01T12:00:00Z', modifier_effects: [{ kind: 'swap', size_name: null, supply_id: 's-milk', group_id: null, quantity: null, unit_id: null, to_supply_id: 's-oat' }] })
  return t
}

module.exports = { setupTables }

// A shift going on Truck 1, one finished yesterday, par levels, and a flag.
// The rpcs act like the database functions, simply.
function addShiftData(state) {
  const t = state.tables
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString()
  const day = (msAgo) => iso(msAgo).slice(0, 10)
  t.shifts = [
    { id: 'sh-1', truck_id: 'tr-1', lead_id: 'u-d1', status: 'open', business_date: day(0), event_name: 'Farmers market', notes: null, started_at: iso(3600e3), start_confirmed_at: null, checklist_done_at: null, end_confirmed_at: null, ended_at: null, count_check_status: 'not_needed' },
    { id: 'sh-0', truck_id: 'tr-2', lead_id: 'u-d1', status: 'closed', business_date: day(86400e3), event_name: 'Ball game', notes: null, started_at: iso(86400e3 + 8 * 3600e3), start_confirmed_at: iso(86400e3 + 7.9 * 3600e3), checklist_done_at: null, end_confirmed_at: iso(86400e3 + 1800e3), ended_at: iso(86400e3), count_check_status: 'not_needed' },
  ]
  t.shift_crew = [
    { shift_id: 'sh-1', user_id: 'u-d1', role: 'lead' },
    { shift_id: 'sh-1', user_id: 'u-m1', role: 'crew' },
    { shift_id: 'sh-0', user_id: 'u-d1', role: 'lead' },
  ]
  t.shift_counts = []
  t.shift_checklist = []
  t.waste_logs = []
  t.waste_lines = []
  t.sales = []
  t.sales_imports = []
  t.item_mappings = []
  t.sales_file_formats = []
  t.shift_results = [
    { id: 'r-1', shift_id: 'sh-0', supply_id: 's-cup-s', group_id: null, start_qty: 200, added_qty: 100, end_qty: 120, waste_qty: 3, actual_qty: 177, expected_qty: null, diff_qty: null, unit_cost: 0.045, flagged: false, flag_reason: null },
    { id: 'r-2', shift_id: 'sh-0', supply_id: 's-cherry', group_id: null, start_qty: 256, added_qty: 0, end_qty: 100, waste_qty: 0, actual_qty: 156, expected_qty: null, diff_qty: null, unit_cost: 0.117, flagged: false, flag_reason: null },
    { id: 'r-3', shift_id: 'sh-0', supply_id: null, group_id: 'grp-syrup', start_qty: 256, added_qty: 0, end_qty: 100, waste_qty: 0, actual_qty: 156, expected_qty: null, diff_qty: null, unit_cost: 0.117, flagged: false, flag_reason: null },
  ]
  t.truck_pars = [
    ['tr-1', 's-cup-s', 300], ['tr-1', 's-cup-l', 200], ['tr-1', 's-cherry', 384], ['tr-1', 's-blue', 256], ['tr-1', 's-ice', 100],
    ['tr-2', 's-cup-s', 250],
  ].map(([truck_id, supply_id, par_quantity]) => ({ truck_id, supply_id, par_quantity, low_quantity: null }))
  t.flags = [
    { id: 'f-1', kind: 'start_mismatch', severity: 'warning', title: "Starting count on Truck 2 didn't match", details: 'These were different from what the app had on the truck: Small shaved ice cup.', shift_id: 'sh-0', truck_id: 'tr-2', status: 'open', created_at: iso(30 * 3600e3) },
  ]

  const shift = (id) => t.shifts.find((s) => s.id === id)
  const levelOf = (place, supply) => t.stock_levels.find((l) => l.place_id === place && l.supply_id === supply)
  const addLevel = (place, supply, q) => {
    const l = levelOf(place, supply)
    if (l) l.quantity = Number(l.quantity) + q
    else t.stock_levels.push({ place_id: place, supply_id: supply, quantity: q, updated_at: new Date().toISOString() })
  }
  const move = (kind, supply, quantity, from, to, shiftId) => {
    t.stock_movements.unshift({ id: `mv-${Math.random()}`, supply_id: supply, quantity, kind, from_place_id: from, to_place_id: to, unit_cost: 0.05, shift_id: shiftId, reason: null, note: null, created_by: state.me.user_id, created_at: new Date().toISOString() })
    if (from) addLevel(from, supply, -quantity)
    if (to) addLevel(to, supply, quantity)
  }
  state.calls = []
  const log = (name, fn) => (args) => {
    state.calls.push(name)
    return fn(args ?? {})
  }
  Object.assign(state.rpcs, {
    open_shifts: () => t.shifts.filter((s) => s.status === 'open').map((s) => ({ shift_id: s.id, truck_id: s.truck_id, lead_id: s.lead_id, started_at: s.started_at, start_confirmed: Boolean(s.start_confirmed_at) })),
    save_shift_counts: log('save_shift_counts', ({ p }) => {
      for (const l of p.lines) {
        t.shift_counts = t.shift_counts.filter((c) => !(c.shift_id === p.shift_id && c.supply_id === l.supply_id && c.kind === p.kind))
        if (l.quantity !== null) t.shift_counts.push({ shift_id: p.shift_id, supply_id: l.supply_id, kind: p.kind, quantity: l.quantity, expected: null, photo_path: null, entered_by: state.me.user_id, client_ts: l.client_ts })
      }
      return null
    }),
    confirm_shift_start: log('confirm_shift_start', ({ p_shift_id }) => {
      const s = shift(p_shift_id)
      const ids = new Set([...t.stock_levels.filter((l) => l.place_id === s.truck_id && l.quantity).map((l) => l.supply_id), ...t.truck_pars.filter((p) => p.truck_id === s.truck_id).map((p) => p.supply_id)])
      for (const id of ids) {
        const expected = Number(levelOf(s.truck_id, id)?.quantity ?? 0)
        const c = t.shift_counts.find((x) => x.shift_id === s.id && x.supply_id === id && x.kind === 'start')
        if (c) {
          c.expected = expected
          addLevel(s.truck_id, id, c.quantity - expected)
        } else t.shift_counts.push({ shift_id: s.id, supply_id: id, kind: 'start', quantity: expected, expected, photo_path: null, entered_by: null, client_ts: new Date().toISOString() })
      }
      s.start_confirmed_at = new Date().toISOString()
      return null
    }),
    load_truck: log('load_truck', ({ p }) => {
      const s = shift(p.shift_id)
      for (const l of p.lines) move('load', l.supply_id, l.quantity, p.location_id, s.truck_id, s.id)
      return p.lines.length
    }),
    return_from_truck: log('return_from_truck', ({ p }) => {
      const s = shift(p.shift_id)
      for (const l of p.lines) move('return', l.supply_id, l.quantity, s.truck_id, p.location_id, s.id)
      return p.lines.length
    }),
    set_checklist_item: log('set_checklist_item', ({ p_shift_id, p_item_id, p_checked }) => {
      t.shift_checklist = t.shift_checklist.filter((c) => !(c.shift_id === p_shift_id && c.item_id === p_item_id))
      if (p_checked) t.shift_checklist.push({ shift_id: p_shift_id, item_id: p_item_id, checked_by: state.me.user_id })
      return null
    }),
    finish_checklist: log('finish_checklist', ({ p_shift_id }) => {
      shift(p_shift_id).checklist_done_at = new Date().toISOString()
      return null
    }),
    log_waste: log('log_waste', ({ p }) => {
      const place = p.shift_id ? shift(p.shift_id).truck_id : p.place_id
      const id = `w-${t.waste_logs.length + 1}`
      t.waste_logs.push({ id, place_id: place, shift_id: p.shift_id, supply_id: p.supply_id ?? null, product_size_id: p.product_size_id ?? null, modifier_ids: p.modifier_ids ?? [], quantity: p.quantity, reason_id: p.reason_id, note: p.note || null, photo_path: p.photo_path ?? null, cost: 0.5, created_by: state.me.user_id, created_at: new Date().toISOString() })
      if (p.supply_id) move('waste', p.supply_id, p.quantity, place, null, p.shift_id)
      state.lastWaste = p
      return id
    }),
    confirm_shift_end: log('confirm_shift_end', ({ p_shift_id }) => {
      shift(p_shift_id).end_confirmed_at = new Date().toISOString()
      return null
    }),
    finish_shift: log('finish_shift', ({ p_shift_id }) => {
      const s = shift(p_shift_id)
      s.status = 'closed'
      s.ended_at = new Date().toISOString()
      for (const c of t.shift_counts.filter((x) => x.shift_id === s.id && x.kind === 'start')) {
        const end = Number(t.shift_counts.find((x) => x.shift_id === s.id && x.supply_id === c.supply_id && x.kind === 'end')?.quantity ?? 0)
        const added = t.stock_movements.filter((m) => m.shift_id === s.id && m.supply_id === c.supply_id && m.kind === 'load').reduce((a, m) => a + m.quantity, 0)
        const waste = t.stock_movements.filter((m) => m.shift_id === s.id && m.supply_id === c.supply_id && m.kind === 'waste').reduce((a, m) => a + m.quantity, 0)
        t.shift_results.push({ id: `r-${Math.random()}`, shift_id: s.id, supply_id: c.supply_id, group_id: null, start_qty: c.quantity, added_qty: added, end_qty: end, waste_qty: waste, actual_qty: c.quantity + added - end - waste, expected_qty: null, diff_qty: null, unit_cost: 0.05, flagged: false, flag_reason: null })
      }
      return null
    }),
    review_flag: log('review_flag', ({ p_flag_id }) => {
      t.flags.find((f) => f.id === p_flag_id).status = 'reviewed'
      return null
    }),
  })
}

module.exports.addShiftData = addShiftData

// Sales on yesterday's shift (a driver count and a file), an upload, and a
// count check waiting. Call after addShiftData.
function addSalesData(state) {
  const t = state.tables
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString()
  t.shifts.find((s) => s.id === 'sh-0').count_check_status = 'waiting'
  t.shift_counts.push(
    { shift_id: 'sh-0', supply_id: 's-cup-s', kind: 'end', quantity: 120, expected: null, photo_path: null, entered_by: 'u-d1', client_ts: iso(86400e3) },
    { shift_id: 'sh-0', supply_id: 's-cup-l', kind: 'end', quantity: 80, expected: null, photo_path: null, entered_by: 'u-d1', client_ts: iso(86400e3) },
  )
  t.stock_levels.push({ place_id: 'tr-2', supply_id: 's-cup-s', quantity: 120, updated_at: iso(0) }, { place_id: 'tr-2', supply_id: 's-cup-l', quantity: 80, updated_at: iso(0) })
  Object.assign(t.shift_results.find((r) => r.id === 'r-1'), { expected_qty: 160, diff_qty: 17, flagged: true, flag_reason: 'Small shaved ice cup: used 17 more than sales show (11%)' })
  Object.assign(t.shift_results.find((r) => r.id === 'r-3'), { expected_qty: 150, diff_qty: 6, flagged: false })
  t.sales_imports = [
    { id: 'imp-1', source: 'csv', file_name: 'square-oct-27.csv', rows_added: 158, rows_duplicate: 0, rows_ignored: 4, rows_unmatched: 0, rows_no_shift: 2, unmatched_names: [], undone_at: null, created_by: 'u-m1', created_at: iso(20 * 3600e3) },
  ]
  const sale = (id, shift, truck, size, qty, price, source, extra = {}) => ({
    id, truck_id: truck, shift_id: shift, sold_at: iso(26 * 3600e3), product_size_id: size, modifier_ids: [], quantity: qty, price, is_free: false,
    free_reason_id: null, source, source_ref: `${shift}:${id}`, outside_name: null, import_id: null, client_ts: iso(26 * 3600e3), ...extra,
  })
  t.sales = [
    sale('sa-1', 'sh-0', 'tr-2', 'ps-ice-s', 150, 600, 'csv', { import_id: 'imp-1' }),
    sale('sa-2', 'sh-0', 'tr-2', 'ps-ice-s', 10, 0, 'csv', { import_id: 'imp-1', is_free: true }),
    sale('sa-3', 'sh-0', 'tr-2', 'ps-ice-s', 148, 592, 'driver'),
    sale('sa-4', 'sh-0', 'tr-2', 'ps-ice-s', 12, 0, 'driver', { is_free: true, free_reason_id: 'fr-0' }),
  ]
  t.item_mappings = [{ id: 'im-1', source: 'csv', kind: 'item', outside_key: 'shaved ice · large', outside_name: 'Shaved Ice · Large', product_size_id: 'ps-ice-l', modifier_id: null, truck_id: null, ignore: false }]
  t.sales_file_formats = []

  const shift = (id) => t.shifts.find((s) => s.id === id)
  const log = (name, fn) => (args) => {
    state.calls.push(name)
    return fn(args ?? {})
  }
  Object.assign(state.rpcs, {
    save_sales_tally: log('save_sales_tally', ({ p }) => {
      const s = shift(p.shift_id)
      const source = state.me.profile.role === 'driver' ? 'driver' : 'manager'
      for (const l of p.lines) {
        const ref = `${s.id}:${l.key}`
        t.sales = t.sales.filter((x) => !(x.source === source && x.source_ref === ref))
        if (l.quantity > 0) t.sales.push(sale(`sa-${Math.random()}`, s.id, s.truck_id, l.product_size_id, l.quantity, l.is_free ? 0 : l.quantity * 4, source, { source_ref: ref, modifier_ids: l.modifier_ids, is_free: l.is_free, free_reason_id: l.free_reason_id, client_ts: l.client_ts, sold_at: s.started_at }))
      }
      return null
    }),
    record_count_check: log('record_count_check', ({ p }) => {
      const s = shift(p.shift_id)
      for (const l of p.lines) t.shift_counts.push({ shift_id: s.id, supply_id: l.supply_id, kind: 'check', quantity: l.quantity, expected: null, photo_path: null, entered_by: state.me.user_id, client_ts: new Date().toISOString() })
      s.count_check_status = 'done'
      return null
    }),
    ingest_sales: log('ingest_sales', ({ p }) => {
      state.lastIngest = p
      if (!t.sales_imports.some((i) => i.id === p.import_id)) t.sales_imports.unshift({ id: p.import_id, source: 'csv', file_name: p.file_name, rows_added: 0, rows_duplicate: 0, rows_ignored: 0, rows_unmatched: 0, rows_no_shift: 0, unmatched_names: [], undone_at: null, created_by: state.me.user_id, created_at: new Date().toISOString() })
      const imp = t.sales_imports.find((i) => i.id === p.import_id)
      imp.rows_added += p.rows.length
      return { import_id: p.import_id, added: p.rows.length, duplicates: 0, ignored: 0, unmatched: 0, no_shift: 0, unmatched_names: [] }
    }),
    undo_sales_import: log('undo_sales_import', ({ p_import_id }) => {
      t.sales_imports.find((i) => i.id === p_import_id).undone_at = new Date().toISOString()
      t.sales = t.sales.filter((x) => x.import_id !== p_import_id)
      return 1
    }),
  })
}

module.exports.addSalesData = addSalesData

// Plans for this week, an order list waiting for approval, par suggestions,
// and notification choices. Call after addShiftData.
function addPlanData(state) {
  const t = state.tables
  t.company_settings[0].scheduling_enabled = true
  const at = (dayOffset, hour) => {
    const d = new Date()
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hour, 0, 0, 0)
    return d.toISOString()
  }
  const plan = (id, truck, day, from, to, lead, crew, extra = {}) => {
    t.schedules.push({ id, truck_id: truck, starts_at: at(day, from), ends_at: at(day, to), event_name: null, place: null, notes: null, lead_id: lead, status: 'planned', series_id: null, ...extra })
    for (const u of crew) t.schedule_crew.push({ schedule_id: id, user_id: u })
  }
  t.schedules = []
  t.schedule_crew = []
  plan('pl-1', 'tr-2', 0, 11, 18, 'u-d1', ['u-d2'], { event_name: 'Ball game', place: 'Riverside Park' })
  plan('pl-2', 'tr-3', 0, 7, 13, 'u-m1', [], { event_name: 'Office park' })
  plan('pl-3', 'tr-1', 1, 12, 20, 'u-d1', [], { series_id: 'ser-1' })
  plan('pl-4', 'tr-1', 2, 12, 20, 'u-d2', ['u-d1'], { status: 'cancelled' })
  t.purchase_orders = [
    { id: 'po-1', supplier_id: 'sup-1', status: 'draft', edited: false, note: null, estimated_total: 38.4, created_at: at(0, 6), approved_at: null, sent_at: null, received_at: null },
    { id: 'po-2', supplier_id: 'sup-2', status: 'sent', edited: false, note: null, estimated_total: 45, created_at: at(-2, 6), approved_at: at(-2, 8), sent_at: at(-2, 8), received_at: null },
  ]
  t.purchase_order_lines = [
    { order_id: 'po-1', supply_id: 's-milk', quantity: 768, unit_cost: 0.05 },
    { order_id: 'po-2', supply_id: 's-cup-s', quantity: 1000, unit_cost: 0.045 },
  ]
  t.par_suggestions = [
    { truck_id: 'tr-1', supply_id: 's-cup-s', suggested_qty: 350, avg_used: 280, shifts_counted: 8 },
    { truck_id: 'tr-1', supply_id: 's-ice', suggested_qty: 120, avg_used: 92, shifts_counted: 8 },
  ]
  t.notification_settings = []
  t.push_subscriptions = []
  t.deliveries = []

  const log = (name, fn) => (args) => {
    state.calls.push(name)
    return fn(args ?? {})
  }
  Object.assign(state.rpcs, {
    save_schedule: log('save_schedule', ({ p }) => {
      const id = p.id ?? `pl-new-${t.schedules.length}`
      t.schedules = t.schedules.filter((x) => x.id !== id)
      t.schedules.push({ id, truck_id: p.truck_id, starts_at: p.starts_at, ends_at: p.ends_at, event_name: p.event_name || null, place: p.place || null, notes: p.notes || null, lead_id: p.lead_id, status: 'planned', series_id: null })
      t.schedule_crew = t.schedule_crew.filter((c) => c.schedule_id !== id)
      for (const u of p.crew_ids) t.schedule_crew.push({ schedule_id: id, user_id: u })
      return id
    }),
    cancel_schedule: log('cancel_schedule', ({ p_schedule_id }) => {
      t.schedules.find((x) => x.id === p_schedule_id).status = 'cancelled'
      return 1
    }),
    build_order_lists: log('build_order_lists', () => 1),
    save_purchase_order: log('save_purchase_order', ({ p }) => {
      t.purchase_order_lines = t.purchase_order_lines.filter((l) => l.order_id !== p.order_id)
      for (const l of p.lines) t.purchase_order_lines.push({ order_id: p.order_id, supply_id: l.supply_id, quantity: l.quantity, unit_cost: 0.05 })
      t.purchase_orders.find((o) => o.id === p.order_id).edited = true
      return null
    }),
    approve_purchase_order: log('approve_purchase_order', ({ p_order_id }) => {
      Object.assign(t.purchase_orders.find((o) => o.id === p_order_id), { status: 'sent', approved_at: new Date().toISOString(), sent_at: new Date().toISOString() })
      return 'sent'
    }),
    set_purchase_order_status: log('set_purchase_order_status', ({ p_order_id, p_status }) => {
      t.purchase_orders.find((o) => o.id === p_order_id).status = p_status
      return null
    }),
    apply_par_suggestions: log('apply_par_suggestions', ({ p_truck_id }) => {
      for (const sg of t.par_suggestions.filter((x) => x.truck_id === p_truck_id)) {
        const par = t.truck_pars.find((x) => x.truck_id === sg.truck_id && x.supply_id === sg.supply_id)
        if (par) par.par_quantity = sg.suggested_qty
        else t.truck_pars.push({ truck_id: sg.truck_id, supply_id: sg.supply_id, par_quantity: sg.suggested_qty, low_quantity: null })
      }
      return 2
    }),
  })
}

module.exports.addPlanData = addPlanData

// Report numbers and count fixes for the reports flow. Call after addSalesData.
function addReportData(state) {
  const t = state.tables
  t.audit_log = []
  const log = (name, fn) => (args) => {
    state.calls.push(name)
    return fn(args ?? {})
  }
  Object.assign(state.rpcs, {
    report: log('report', () => ({
      totals: { shifts: 2, drinks: 330, free: 12, revenue: 1312, used: 210.4, shift_waste: 3.1, off_cost: 9.5, flagged_shifts: 1, all_waste: 5.2 },
      shifts: [
        { id: 'sh-0', truck_id: 'tr-2', lead_id: 'u-d1', business_date: '2026-10-27', event_name: 'Ball game', count_check_status: 'done', drinks: 160, free: 10, revenue: 600, used: 96.2, waste: 0.5, off_cost: 7.2, flagged: 1, source: 'file' },
        { id: 'sh-9', truck_id: 'tr-1', lead_id: 'u-d2', business_date: '2026-10-26', event_name: null, count_check_status: 'not_needed', drinks: 170, free: 2, revenue: 712, used: 114.2, waste: 2.6, off_cost: 2.3, flagged: 0, source: 'driver' },
      ],
      supplies: [
        { supply_id: 's-cup-s', group_id: null, actual: 330, expected: 313, diff: 17, cost: 14.85, shifts: 2 },
        { supply_id: null, group_id: 'grp-syrup', actual: 690, expected: 660, diff: 30, cost: null, shifts: 2 },
        { supply_id: 's-ice', group_id: null, actual: 140, expected: 132, diff: 8, cost: 42, shifts: 2 },
      ],
      waste_reasons: [{ reason_id: 'wr-1', count: 3, cost: 3.1 }, { reason_id: 'wr-3', count: 1, cost: 2.1 }],
      waste_supplies: [{ supply_id: 's-ice', quantity: 7, cost: 2.1 }, { supply_id: 's-cup-s', quantity: 20, cost: 0.9 }],
      free_reasons: [{ reason_id: 'fr-0', drinks: 8, cost: 2.8 }, { reason_id: 'fr-2', drinks: 4, cost: 1.4 }],
      drivers: [
        { user_id: 'u-d1', shifts: 1, drinks: 160, revenue: 600, used: 96.2, waste: 0.5, off_cost: 7.2, flagged_shifts: 1 },
        { user_id: 'u-d2', shifts: 1, drinks: 170, revenue: 712, used: 114.2, waste: 2.6, off_cost: 2.3, flagged_shifts: 0 },
      ],
      count_checks: { done: 1, missed: 0, waiting: 0, different: 1 },
      days: [
        { date: '2026-10-26', shifts: 1, drinks: 170, revenue: 712, used: 114.2, waste: 2.6 },
        { date: '2026-10-27', shifts: 1, drinks: 160, revenue: 600, used: 96.2, waste: 0.5 },
      ],
    })),
    correct_shift_count: log('correct_shift_count', ({ p }) => {
      t.audit_log.unshift({ id: Date.now(), actor_id: state.me.user_id, action: 'correct', table_name: 'shift_counts', row_id: p.shift_id, old_data: { supply_id: p.supply_id, kind: p.kind, quantity: 120 }, new_data: { supply_id: p.supply_id, kind: p.kind, quantity: p.quantity }, reason: p.reason, created_at: new Date().toISOString() })
      return null
    }),
  })
}

module.exports.addReportData = addReportData
