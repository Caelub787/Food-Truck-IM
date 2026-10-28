import { useRows } from '@/lib/data'
import { useLiveQuery } from '@/lib/live'
import { supabase } from '@/lib/supabase'
import { unitsFor, type Unit, type UnitRow } from '@/lib/units'

// Shapes of the setup tables and live hooks to read them.

export type Named = { id: string; name: string; active: boolean; sort?: number }
export type Location = Named & { kind: 'warehouse' | 'storage' | 'commissary' | 'other'; address: string | null }
export type TruckType = Named
export type Truck = Named & { truck_type_id: string | null; home_location_id: string | null; notes: string | null }
export type Supplier = Named & {
  contact_name: string | null
  email: string | null
  phone: string | null
  order_method: 'email' | 'self'
  order_days: string | null
  minimum_order: number | null
  notes: string | null
}
export type SupplyGroup = Named & { base_unit: string }
export type Supply = Named & {
  category: string | null
  base_unit: string
  count_unit_id: string | null
  purchase_unit_id: string | null
  supplier_id: string | null
  truck_type_id: string | null
  group_id: string | null
  cost_per_base: number
  reorder_level: number | null
  order_up_to: number | null
  whole_only: boolean
  tracks_expiration: boolean
  shelf_life_days: number | null
  count_check: boolean
  diff_percent: number | null
  diff_min_qty: number | null
  notes: string | null
}
export type Product = Named & { category: string | null; truck_type_id: string | null }
export type ProductSize = Named & { product_id: string; price: number | null }
export type ModifierGroup = Named
export type Modifier = Named & { group_id: string; price: number }
export type ProductModifierGroup = { product_id: string; group_id: string }
export type RecipeLine = { supply_id: string | null; group_id: string | null; quantity: number; unit_id: string | null }
export type ModifierEffect = {
  kind: 'add' | 'swap'
  size_name: string | null
  supply_id: string | null
  group_id: string | null
  quantity: number | null
  unit_id: string | null
  to_supply_id: string | null
}

export const useLocations = () => useRows<Location>('locations')
export const useTruckTypes = () => useRows<TruckType>('truck_types')
export const useTrucks = () => useRows<Truck>('trucks')
export const useSuppliers = (enabled = true) => useRows<Supplier>('suppliers', { enabled })
export const useSupplyGroups = () => useRows<SupplyGroup>('supply_groups')
export const useSupplies = () => useRows<Supply>('supplies')
export const useSupplyUnits = () => useRows<UnitRow>('supply_units', { order: 'factor' })
export const useProducts = () => useRows<Product>('products', { order: 'sort,name' })
export const useProductSizes = () => useRows<ProductSize>('product_sizes', { order: 'sort,name' })
export const useModifierGroups = () => useRows<ModifierGroup>('modifier_groups', { order: 'sort,name' })
export const useModifiers = () => useRows<Modifier>('modifiers', { order: 'sort,name' })
export const useProductModifierGroups = () =>
  useRows<ProductModifierGroup>('product_modifier_groups', { select: 'product_id, group_id', order: 'product_id' })

/** The recipe in effect right now for each product size, keyed by size id. */
export function useCurrentRecipes() {
  return useLiveQuery({
    tables: ['recipe_versions', 'recipe_lines'],
    queryKey: ['current-recipes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipe_versions')
        .select('id, product_size_id, effective_from, recipe_lines(supply_id, group_id, quantity, unit_id)')
        .lte('effective_from', new Date().toISOString())
        .order('effective_from', { ascending: false })
      if (error) throw error
      const current = new Map<string, { versionId: string; since: string; lines: RecipeLine[] }>()
      for (const v of data as { id: string; product_size_id: string; effective_from: string; recipe_lines: RecipeLine[] }[]) {
        if (!current.has(v.product_size_id)) current.set(v.product_size_id, { versionId: v.id, since: v.effective_from, lines: v.recipe_lines })
      }
      return current
    },
  })
}

/** How many versions each product size's recipe has had. */
export function useRecipeHistory(sizeIds: string[]) {
  return useLiveQuery({
    tables: ['recipe_versions'],
    queryKey: ['recipe-history', sizeIds],
    enabled: sizeIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipe_versions')
        .select('id, product_size_id, effective_from, note')
        .in('product_size_id', sizeIds)
        .order('effective_from', { ascending: false })
      if (error) throw error
      return data as { id: string; product_size_id: string; effective_from: string; note: string | null }[]
    },
  })
}

/** What each add on does right now, keyed by add on id. */
export function useCurrentModifierEffects() {
  return useLiveQuery({
    tables: ['modifier_versions', 'modifier_effects'],
    queryKey: ['current-modifier-effects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('modifier_versions')
        .select('id, modifier_id, effective_from, modifier_effects(kind, size_name, supply_id, group_id, quantity, unit_id, to_supply_id)')
        .lte('effective_from', new Date().toISOString())
        .order('effective_from', { ascending: false })
      if (error) throw error
      const current = new Map<string, ModifierEffect[]>()
      for (const v of data as { modifier_id: string; modifier_effects: ModifierEffect[] }[]) {
        if (!current.has(v.modifier_id)) current.set(v.modifier_id, v.modifier_effects)
      }
      return current
    },
  })
}

/** Each supply with its units, for unit pickers and amounts. */
export function useSupplyCatalog() {
  const supplies = useSupplies()
  const units = useSupplyUnits()
  const groups = useSupplyGroups()
  const data =
    supplies.data && units.data && groups.data
      ? {
          supplies: supplies.data,
          groups: groups.data,
          units: units.data,
          unitsOf: (supplyId: string): Unit[] => {
            const s = supplies.data!.find((x) => x.id === supplyId)
            return s ? unitsFor(s, units.data!) : []
          },
          supply: (id: string | null) => supplies.data!.find((s) => s.id === id),
          group: (id: string | null) => groups.data!.find((g) => g.id === id),
        }
      : undefined
  return { data, isLoading: supplies.isLoading || units.isLoading || groups.isLoading, error: supplies.error ?? units.error ?? groups.error }
}

export type Catalog = NonNullable<ReturnType<typeof useSupplyCatalog>['data']>

export function byName<T extends { name: string }>(rows: T[] | undefined) {
  return [...(rows ?? [])].sort((a, b) => a.name.localeCompare(b.name))
}

export function activeFirst<T extends { active: boolean; name: string }>(rows: T[] | undefined) {
  return [...(rows ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
}
