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
