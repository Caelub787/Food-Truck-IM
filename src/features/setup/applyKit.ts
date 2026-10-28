import { rpc, supabase } from '@/lib/supabase'
import type { StarterKit } from './starterKits'

type IdName = { id: string; name: string }

async function all(table: string, select = 'id, name'): Promise<IdName[]> {
  const { data, error } = await supabase.from(table).select(select)
  if (error) throw error
  return data as unknown as IdName[]
}

async function findOrInsert(table: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const existing = (await all(table)).find((r) => r.name.toLowerCase() === name.toLowerCase())
  if (existing) return existing.id
  const { data, error } = await supabase
    .from(table)
    .insert({ name, ...extra })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/**
 * Adds a starter kit. Anything that already exists with the same name is left
 * alone, so running a kit twice, or after adding your own items, is safe.
 * Returns how many supplies and products were added.
 */
export async function applyKit(kit: StarterKit, onStep: (text: string) => void) {
  onStep('Adding the truck type')
  const truckTypeId = await findOrInsert('truck_types', kit.truckType)

  const groupIds = new Map<string, string>()
  for (const g of kit.groups) groupIds.set(g.name, await findOrInsert('supply_groups', g.name, { base_unit: g.base_unit }))

  onStep('Adding supplies')
  const existingSupplies = new Set((await all('supplies')).map((s) => s.name.toLowerCase()))
  let supplies = 0
  for (const s of kit.supplies) {
    if (existingSupplies.has(s.name.toLowerCase())) continue
    await rpc('save_supply', {
      p: {
        name: s.name,
        category: s.category,
        base_unit: s.base_unit,
        units: s.units,
        count_unit: s.count_unit ?? '',
        purchase_unit: s.purchase_unit ?? '',
        truck_type_id: truckTypeId,
        group_id: s.group ? groupIds.get(s.group) : null,
        reorder_level: s.reorder_level === undefined ? null : s.reorder_level * countFactor(s),
        order_up_to: s.order_up_to === undefined ? null : s.order_up_to * countFactor(s),
        whole_only: s.whole_only ?? false,
        tracks_expiration: s.tracks_expiration ?? false,
        shelf_life_days: s.shelf_life_days ?? null,
        count_check: s.count_check ?? false,
      },
    })
    supplies++
  }

  onStep('Adding products and recipes')
  const existingProducts = new Set((await all('products')).map((p) => p.name.toLowerCase()))
  const newProducts = kit.products.filter((p) => !existingProducts.has(p.name.toLowerCase()))
  const rows = newProducts.flatMap((p) =>
    p.sizes.flatMap((size) =>
      size.recipe.map((line, i) => ({
        product: p.name,
        category: p.category,
        truck_type: kit.truckType,
        size: size.name,
        price: i === 0 ? String(size.price) : '',
        supply: line.supply,
        amount: String(line.amount),
        unit: line.unit ?? '',
      })),
    ),
  )
  if (rows.length) {
    const result = await rpc<{ errors: { message: string }[] }>('import_products', { p_rows: rows })
    if (result.errors.length) throw new Error(result.errors[0]!.message)
  }

  if (kit.addOnGroups.length) {
    onStep('Adding add ons')
    const supplyIds = new Map((await all('supplies')).map((s) => [s.name.toLowerCase(), s.id]))
    const unitRows = (await all('supply_units', 'id, name, supply_id, factor')) as unknown as {
      id: string
      name: string
      supply_id: string
      factor: number
    }[]
    const productIds = new Map((await all('products')).map((p) => [p.name.toLowerCase(), p.id]))
    for (const group of kit.addOnGroups) {
      const groupId = await findOrInsert('modifier_groups', group.name)
      for (const productName of group.products) {
        const productId = productIds.get(productName.toLowerCase())
        if (productId) {
          await supabase.from('product_modifier_groups').upsert({ product_id: productId, group_id: groupId }, { ignoreDuplicates: true })
        }
      }
      const { data: existing } = await supabase.from('modifiers').select('name').eq('group_id', groupId)
      const have = new Set((existing ?? []).map((m: { name: string }) => m.name.toLowerCase()))
      for (const addOn of group.addOns) {
        if (have.has(addOn.name.toLowerCase())) continue
        const { data: modifier, error } = await supabase
          .from('modifiers')
          .insert({ group_id: groupId, name: addOn.name, price: addOn.price })
          .select('id')
          .single()
        if (error) throw error
        const effects = addOn.effects.map((e) => {
          if (e.kind === 'swap') {
            return { kind: 'swap', supply_id: supplyIds.get(e.from.toLowerCase()), to_supply_id: supplyIds.get(e.to.toLowerCase()) }
          }
          const supplyId = supplyIds.get(e.supply.toLowerCase())!
          const unit = unitRows.find((u) => u.supply_id === supplyId && u.name.toLowerCase() === (e.unit ?? '').toLowerCase())
          return {
            kind: 'add',
            size_name: e.size ?? null,
            supply_id: supplyId,
            quantity: e.amount * Number(unit?.factor ?? 1),
            unit_id: unit?.id ?? null,
          }
        })
        await rpc('save_modifier_effects', { p_modifier_id: (modifier as { id: string }).id, p_effects: effects })
      }
    }
  }

  return { supplies, products: newProducts.length }
}

function countFactor(s: StarterKit['supplies'][number]) {
  return s.units.find((u) => u.name === s.count_unit)?.factor ?? 1
}
