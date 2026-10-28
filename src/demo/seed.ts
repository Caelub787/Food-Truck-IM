// Sample data for the demo: a made up shaved ice and coffee business with a
// few trucks, people, supplies, recipes, past shifts, sales, plans, and an
// order list. Times are relative to now so the demo always looks current.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>
export type Db = Record<string, Row[]>

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const day = (ms: number) => ago(ms).slice(0, 10)
const H = 3600_000
const D = 24 * H

export const DEMO_COMPANY = 'c1'

export const people: Row[] = [
  { user_id: 'u-admin', full_name: 'Sam Rivera', email: 'sam@example.com', phone: '555 0100', role: 'admin', active: true, invited_at: null, joined_at: ago(30 * D) },
  { user_id: 'u-m1', full_name: 'Maria Lopez', email: 'maria@example.com', phone: '555 0101', role: 'manager', active: true, invited_at: ago(29 * D), joined_at: ago(29 * D) },
  { user_id: 'u-d1', full_name: 'Jake Turner', email: 'jake@example.com', phone: null, role: 'driver', active: true, invited_at: ago(28 * D), joined_at: ago(28 * D) },
  { user_id: 'u-d2', full_name: 'Ava Chen', email: 'ava@example.com', phone: null, role: 'driver', active: true, invited_at: ago(20 * D), joined_at: ago(20 * D) },
  { user_id: 'u-d3', full_name: 'Leo Park', email: 'leo@example.com', phone: null, role: 'driver', active: false, invited_at: ago(60 * D), joined_at: ago(59 * D) },
]

export function seed(): Db {
  const t: Db = {}
  t.companies = [{ id: DEMO_COMPANY, name: 'Island Ice Co', status: 'active', phone: '555 0100', timezone: 'America/Chicago', status_reason: null }]
  t.profiles = people.map((p) => ({ ...p, company_id: DEMO_COMPANY }))
  t.company_settings = [
    {
      company_id: DEMO_COMPANY, scheduling_enabled: true, count_checks_enabled: true, count_check_blind: true, count_check_manager_wins: true,
      expiration_tracking: true, loading_checklist_enabled: true, sales_reporters: 'drivers', sales_source_order: ['file', 'manager', 'driver'],
      diff_percent: 10, diff_min_dollars: 2, shift_dollar_limit: 25, par_cushion_percent: 25, par_lookback_shifts: 10, par_auto_update: false,
      expiration_warning_days: 3, morning_hour: 6, daily_report_hour: 20, weekly_report_day: 1, summary_hour: 7, start_reminder_minutes: 30,
      shift_reminder_hours: 12, shift_alert_hours: 16, count_check_reminder_hours: 18, waste_pattern_factor: 1.5, photo_retention_days: 180,
    },
  ]
  t.locations = [
    { id: 'loc-1', name: 'Warehouse', kind: 'warehouse', address: '12 Dock Rd', active: true },
    { id: 'loc-2', name: 'Storage unit B', kind: 'storage', address: null, active: true },
  ]
  t.truck_types = [
    { id: 'tt-ice', name: 'Shaved ice', active: true, sort: 0 },
    { id: 'tt-coffee', name: 'Coffee', active: true, sort: 1 },
  ]
  t.trucks = [
    { id: 'tr-1', name: 'Truck 1', truck_type_id: 'tt-ice', home_location_id: 'loc-1', notes: null, active: true },
    { id: 'tr-2', name: 'Truck 2', truck_type_id: 'tt-ice', home_location_id: 'loc-1', notes: null, active: true },
    { id: 'tr-3', name: 'Coffee Van', truck_type_id: 'tt-coffee', home_location_id: 'loc-1', notes: null, active: true },
  ]
  t.places = [...t.locations.map((l) => ({ id: l.id, kind: 'location' })), ...t.trucks.map((x) => ({ id: x.id, kind: 'truck' }))]
  t.suppliers = [
    { id: 'sup-1', name: 'Dairy Co', contact_name: 'Lee', email: 'orders@dairy.example', phone: '555 0300', order_method: 'email', order_days: 'Tue for Thu', minimum_order: 50, notes: null, active: true },
    { id: 'sup-2', name: 'Paper Supply', contact_name: null, email: null, phone: '555 0400', order_method: 'self', order_days: null, minimum_order: null, notes: null, active: true },
  ]
  t.supply_groups = [{ id: 'grp-syrup', name: 'Syrups (any flavor)', base_unit: 'oz', active: true }]
  const supplies: Row[] = (t.supplies = [])
  const supplyUnits: Row[] = (t.supply_units = [])
  const supply = (id: string, name: string, category: string, base: string, units: [string, number][], count: string | null, extra: Row = {}) => {
    supplies.push({
      id, name, category, base_unit: base, count_unit_id: count ? `${id}-${count}` : null,
      purchase_unit_id: units.length > 1 ? `${id}-${units[units.length - 1]![0]}` : count ? `${id}-${count}` : null,
      supplier_id: null, truck_type_id: null, group_id: null, cost_per_base: 0, reorder_level: null, order_up_to: null, whole_only: false,
      tracks_expiration: false, shelf_life_days: null, count_check: false, diff_percent: null, diff_min_qty: null, notes: null, active: true, ...extra,
    })
    for (const [unit, factor] of units) supplyUnits.push({ id: `${id}-${unit}`, supply_id: id, name: unit, factor })
  }
  supply('s-milk', 'Whole milk', 'Milk', 'oz', [['half gallon', 64], ['case', 384]], 'half gallon', { supplier_id: 'sup-1', cost_per_base: 0.05, reorder_level: 960, order_up_to: 1536, tracks_expiration: true, shelf_life_days: 10, truck_type_id: 'tt-coffee' })
  supply('s-oat', 'Oat milk', 'Milk', 'oz', [['half gallon', 64], ['case', 384]], 'half gallon', { supplier_id: 'sup-1', cost_per_base: 0.0625, truck_type_id: 'tt-coffee' })
  supply('s-beans', 'Espresso beans', 'Coffee', 'g', [['shot', 9], ['bag', 2268]], 'bag', { cost_per_base: 0.024, truck_type_id: 'tt-coffee' })
  supply('s-cherry', 'Cherry syrup', 'Syrup', 'oz', [['gallon', 128], ['case', 512]], 'gallon', { group_id: 'grp-syrup', cost_per_base: 0.117, truck_type_id: 'tt-ice' })
  supply('s-blue', 'Blue raspberry syrup', 'Syrup', 'oz', [['gallon', 128], ['case', 512]], 'gallon', { group_id: 'grp-syrup', cost_per_base: 0.117, truck_type_id: 'tt-ice' })
  supply('s-cup-s', 'Small shaved ice cup', 'Cups', 'each', [['sleeve', 50], ['case', 1000]], 'sleeve', { supplier_id: 'sup-2', cost_per_base: 0.045, count_check: true, reorder_level: 500, order_up_to: 2000, truck_type_id: 'tt-ice' })
  supply('s-cup-l', 'Large shaved ice cup', 'Cups', 'each', [['sleeve', 50], ['case', 1000]], 'sleeve', { supplier_id: 'sup-2', cost_per_base: 0.06, count_check: true, truck_type_id: 'tt-ice' })
  supply('s-ice', 'Ice', 'Ice', 'lb', [['bag', 10]], 'bag', { cost_per_base: 0.3, truck_type_id: 'tt-ice' })

  t.products = [
    { id: 'p-ice', name: 'Shaved ice', category: 'Shaved ice', truck_type_id: 'tt-ice', active: true, sort: 0 },
    { id: 'p-latte', name: 'Latte', category: 'Espresso drinks', truck_type_id: 'tt-coffee', active: true, sort: 1 },
  ]
  t.product_sizes = [
    { id: 'ps-ice-s', product_id: 'p-ice', name: 'Small', price: 4, active: true, sort: 0 },
    { id: 'ps-ice-l', product_id: 'p-ice', name: 'Large', price: 6, active: true, sort: 1 },
    { id: 'ps-latte-m', product_id: 'p-latte', name: 'Medium', price: 5, active: true, sort: 0 },
    { id: 'ps-latte-l', product_id: 'p-latte', name: 'Large', price: 5.5, active: true, sort: 1 },
  ]
  t.modifier_groups = [{ id: 'mg-milk', name: 'Milk', active: true, sort: 0 }]
  t.modifiers = [{ id: 'm-oat', group_id: 'mg-milk', name: 'Oat milk', price: 0.75, active: true, sort: 0 }]
  t.product_modifier_groups = [{ product_id: 'p-latte', group_id: 'mg-milk' }]
  t.recipe_versions = [
    { id: 'rv-1', product_size_id: 'ps-ice-s', effective_from: ago(40 * D), note: null, recipe_lines: [
      { supply_id: 's-cup-s', group_id: null, quantity: 1, unit_id: null },
      { supply_id: 's-ice', group_id: null, quantity: 0.4, unit_id: null },
      { supply_id: null, group_id: 'grp-syrup', quantity: 2, unit_id: null },
    ] },
    { id: 'rv-2', product_size_id: 'ps-ice-l', effective_from: ago(40 * D), note: null, recipe_lines: [
      { supply_id: 's-cup-l', group_id: null, quantity: 1, unit_id: null },
      { supply_id: 's-ice', group_id: null, quantity: 0.7, unit_id: null },
      { supply_id: null, group_id: 'grp-syrup', quantity: 3, unit_id: null },
    ] },
    { id: 'rv-3', product_size_id: 'ps-latte-l', effective_from: ago(40 * D), note: null, recipe_lines: [
      { supply_id: 's-beans', group_id: null, quantity: 27, unit_id: 's-beans-shot' },
      { supply_id: 's-milk', group_id: null, quantity: 14, unit_id: null },
    ] },
  ]
  t.recipe_lines = []
  t.modifier_versions = [
    { id: 'mv-1', modifier_id: 'm-oat', effective_from: ago(40 * D), modifier_effects: [{ kind: 'swap', size_name: null, supply_id: 's-milk', group_id: null, quantity: null, unit_id: null, to_supply_id: 's-oat' }] },
  ]
  t.modifier_effects = []
  t.waste_reasons = ['Spilled', 'Dropped', 'Expired', 'Melted'].map((name, i) => ({ id: `wr-${i}`, name, active: true, sort: i }))
  t.free_reasons = ['Drop replacement', 'Giveaway or promo', 'Employee drink'].map((name, i) => ({ id: `fr-${i}`, name, active: true, sort: i }))
  t.checklist_items = ['Generator fueled', 'Cash bank counted', 'Card reader charged'].map((name, i) => ({ id: `ck-${i}`, name, truck_type_id: null, active: true, sort: i }))

  t.stock_levels = (
    [
      ['loc-1', 's-milk', 900], ['loc-1', 's-oat', 200], ['loc-1', 's-beans', 9072], ['loc-1', 's-cherry', 1024], ['loc-1', 's-blue', 128],
      ['loc-1', 's-cup-s', 400], ['loc-1', 's-cup-l', 3000], ['loc-1', 's-ice', 400],
      ['tr-1', 's-cherry', 256], ['tr-1', 's-cup-s', 150], ['tr-1', 's-ice', 80],
      ['tr-2', 's-cherry', 100], ['tr-2', 's-cup-s', 120], ['tr-2', 's-cup-l', 80], ['tr-2', 's-ice', 30],
    ] as [string, string, number][]
  ).map(([place_id, supply_id, quantity]) => ({ place_id, supply_id, quantity, updated_at: ago(2 * H) }))
  t.stock_batches = [
    { id: 'b-1', place_id: 'loc-1', supply_id: 's-milk', expires_on: day(-2 * D), received_on: day(8 * D), quantity: 384 },
    { id: 'b-2', place_id: 'loc-1', supply_id: 's-milk', expires_on: day(-20 * D), received_on: day(D), quantity: 516 },
  ]
  t.stock_movements = [
    { id: 'mv-a', supply_id: 's-milk', quantity: 384, kind: 'delivery', from_place_id: null, to_place_id: 'loc-1', unit_cost: 0.05, shift_id: null, reason: null, note: null, created_by: 'u-m1', created_at: ago(D) },
    { id: 'mv-b', supply_id: 's-cup-s', quantity: 150, kind: 'load', from_place_id: 'loc-1', to_place_id: 'tr-1', unit_cost: 0.045, shift_id: null, reason: null, note: null, created_by: 'u-d1', created_at: ago(5 * H) },
    { id: 'mv-c', supply_id: 's-ice', quantity: 20, kind: 'adjustment', from_place_id: 'loc-1', to_place_id: null, unit_cost: 0.3, shift_id: null, reason: 'Count', note: null, created_by: 'u-admin', created_at: ago(3 * H) },
  ]
  t.deliveries = []
  t.stock_counts = []

  // Shifts: one going now on Truck 1, one finished yesterday on Truck 2 (waiting for a count check).
  t.shifts = [
    { id: 'sh-1', truck_id: 'tr-1', lead_id: 'u-d1', status: 'open', business_date: day(0), event_name: 'Farmers market', notes: null, schedule_id: null, started_at: ago(H), start_confirmed_at: null, checklist_done_at: null, end_confirmed_at: null, ended_at: null, count_check_status: 'not_needed' },
    { id: 'sh-0', truck_id: 'tr-2', lead_id: 'u-d1', status: 'closed', business_date: day(D), event_name: 'Ball game', notes: null, schedule_id: null, started_at: ago(D + 8 * H), start_confirmed_at: ago(D + 7.9 * H), checklist_done_at: null, end_confirmed_at: ago(D + 0.5 * H), ended_at: ago(D), count_check_status: 'waiting' },
  ]
  t.shift_crew = [
    { shift_id: 'sh-1', user_id: 'u-d1', role: 'lead' },
    { shift_id: 'sh-1', user_id: 'u-d2', role: 'crew' },
    { shift_id: 'sh-0', user_id: 'u-d1', role: 'lead' },
  ]
  t.shift_counts = [
    { shift_id: 'sh-0', supply_id: 's-cup-s', kind: 'end', quantity: 120, expected: null, photo_path: null, entered_by: 'u-d1', client_ts: ago(D + H) },
    { shift_id: 'sh-0', supply_id: 's-cup-l', kind: 'end', quantity: 80, expected: null, photo_path: null, entered_by: 'u-d1', client_ts: ago(D + H) },
  ]
  t.shift_checklist = []
  t.shift_results = [
    { id: 'r-1', shift_id: 'sh-0', supply_id: 's-cup-s', group_id: null, start_qty: 200, added_qty: 100, end_qty: 120, waste_qty: 3, actual_qty: 177, expected_qty: 160, diff_qty: 17, unit_cost: 0.045, flagged: true, flag_reason: 'Small shaved ice cup: used 17 more than sales show (11%)' },
    { id: 'r-2', shift_id: 'sh-0', supply_id: 's-cup-l', group_id: null, start_qty: 100, added_qty: 50, end_qty: 80, waste_qty: 0, actual_qty: 70, expected_qty: 70, diff_qty: 0, unit_cost: 0.06, flagged: false, flag_reason: null },
    { id: 'r-3', shift_id: 'sh-0', supply_id: 's-cherry', group_id: null, start_qty: 256, added_qty: 128, end_qty: 100, waste_qty: 0, actual_qty: 284, expected_qty: null, diff_qty: null, unit_cost: 0.117, flagged: false, flag_reason: null },
    { id: 'r-4', shift_id: 'sh-0', supply_id: null, group_id: 'grp-syrup', start_qty: 256, added_qty: 128, end_qty: 100, waste_qty: 0, actual_qty: 284, expected_qty: 270, diff_qty: 14, unit_cost: 0.117, flagged: false, flag_reason: null },
    { id: 'r-5', shift_id: 'sh-0', supply_id: 's-ice', group_id: null, start_qty: 50, added_qty: 100, end_qty: 30, waste_qty: 2, actual_qty: 118, expected_qty: 113, diff_qty: 5, unit_cost: 0.3, flagged: false, flag_reason: null },
  ]
  t.waste_logs = [
    { id: 'w-1', place_id: 'tr-2', shift_id: 'sh-0', supply_id: 's-cup-s', product_size_id: null, modifier_ids: [], quantity: 3, reason_id: 'wr-1', note: 'Wind took a sleeve', photo_path: null, cost: 0.14, created_by: 'u-d1', created_at: ago(D + 3 * H) },
  ]
  t.waste_lines = []
  t.truck_pars = (
    [['tr-1', 's-cup-s', 300], ['tr-1', 's-cup-l', 200], ['tr-1', 's-cherry', 384], ['tr-1', 's-blue', 256], ['tr-1', 's-ice', 100], ['tr-2', 's-cup-s', 250]] as [string, string, number][]
  ).map(([truck_id, supply_id, par_quantity]) => ({ truck_id, supply_id, par_quantity, low_quantity: null }))
  t.flags = [
    { id: 'f-1', kind: 'usage_diff', severity: 'warning', title: 'Truck 2 used different amounts than sales show', details: 'Small shaved ice cup: used 17 more than sales show (11%).', shift_id: 'sh-0', truck_id: 'tr-2', status: 'open', reviewed_by: null, reviewed_at: null, review_note: null, created_at: ago(D) },
    { id: 'f-2', kind: 'expiring', severity: 'info', title: 'Whole milk expires soon at Warehouse', details: 'Use it first.', shift_id: null, truck_id: null, status: 'open', reviewed_by: null, reviewed_at: null, review_note: null, created_at: ago(5 * H) },
  ]

  // Sales on yesterday's shift: a sales file and the driver's count (they don't quite match).
  const sale = (id: string, size: string, qty: number, price: number, source: string, extra: Row = {}) => ({
    id, truck_id: 'tr-2', shift_id: 'sh-0', sold_at: ago(D + 4 * H), product_size_id: size, modifier_ids: [], quantity: qty, price, is_free: false,
    free_reason_id: null, source, source_ref: `sh-0:${id}`, outside_name: null, import_id: null, client_ts: ago(D + 4 * H), ...extra,
  })
  t.sales = [
    sale('sa-1', 'ps-ice-s', 150, 600, 'csv', { import_id: 'imp-1' }),
    sale('sa-2', 'ps-ice-s', 10, 0, 'csv', { import_id: 'imp-1', is_free: true }),
    sale('sa-5', 'ps-ice-l', 70, 420, 'csv', { import_id: 'imp-1' }),
    sale('sa-3', 'ps-ice-s', 148, 592, 'driver'),
    sale('sa-4', 'ps-ice-s', 12, 0, 'driver', { is_free: true, free_reason_id: 'fr-0' }),
    sale('sa-6', 'ps-ice-l', 70, 420, 'driver'),
  ]
  t.sales_imports = [
    { id: 'imp-1', source: 'csv', file_name: 'register-export.csv', rows_added: 230, rows_duplicate: 0, rows_ignored: 4, rows_unmatched: 0, rows_no_shift: 0, unmatched_names: [], undone_at: null, created_by: 'u-m1', created_at: ago(20 * H) },
  ]
  t.item_mappings = []
  t.sales_file_formats = []

  // This week's plans.
  const at = (dayOffset: number, hour: number) => {
    const d = new Date()
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hour, 0, 0, 0)
    return d.toISOString()
  }
  t.schedules = [
    { id: 'pl-1', truck_id: 'tr-3', starts_at: ago(H), ends_at: ago(-5 * H), event_name: 'Office park', place: 'Building C lot', notes: null, lead_id: 'u-m1', status: 'planned', series_id: null },
    { id: 'pl-2', truck_id: 'tr-1', starts_at: at(1, 12), ends_at: at(1, 20), event_name: 'Ball game', place: 'Riverside Park', notes: null, lead_id: 'u-d1', status: 'planned', series_id: 'ser-1' },
    { id: 'pl-3', truck_id: 'tr-2', starts_at: at(2, 11), ends_at: at(2, 18), event_name: null, place: null, notes: 'Bring extra cups', lead_id: 'u-d2', status: 'planned', series_id: null },
  ]
  t.schedule_crew = [{ schedule_id: 'pl-2', user_id: 'u-d2' }]

  t.purchase_orders = [
    { id: 'po-1', supplier_id: 'sup-1', status: 'draft', edited: false, note: null, estimated_total: 38.4, created_at: ago(4 * H), approved_at: null, sent_at: null, received_at: null },
  ]
  t.purchase_order_lines = [{ order_id: 'po-1', supply_id: 's-milk', quantity: 768, unit_cost: 0.05 }]
  t.par_suggestions = [
    { truck_id: 'tr-1', supply_id: 's-cup-s', suggested_qty: 350, avg_used: 280, shifts_counted: 8 },
    { truck_id: 'tr-1', supply_id: 's-ice', suggested_qty: 120, avg_used: 92, shifts_counted: 8 },
  ]
  t.notification_settings = []
  t.push_subscriptions = []
  t.audit_log = []
  t.job_runs = []
  return t
}
