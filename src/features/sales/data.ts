import { useLiveQuery } from '@/lib/live'
import { supabase } from '@/lib/supabase'
import type { Settings } from '@/features/settings/useSettings'
import { useRows } from '@/lib/data'

export type Sale = {
  id: string
  truck_id: string
  shift_id: string | null
  sold_at: string
  product_size_id: string
  modifier_ids: string[]
  quantity: number
  price: number
  is_free: boolean
  free_reason_id: string | null
  source: 'driver' | 'manager' | 'csv' | 'square'
  source_ref: string
  outside_name: string | null
  import_id: string | null
  client_ts: string
}
export type SaleGroup = 'file' | 'manager' | 'driver'
export type SalesImport = {
  id: string
  source: 'csv' | 'square'
  file_name: string | null
  rows_added: number
  rows_duplicate: number
  rows_ignored: number
  rows_unmatched: number
  rows_no_shift: number
  unmatched_names: string[]
  undone_at: string | null
  created_by: string | null
  created_at: string
}
export type ItemMapping = {
  id: string
  source: 'csv' | 'square'
  kind: 'item' | 'modifier' | 'truck'
  outside_key: string
  outside_name: string | null
  product_size_id: string | null
  modifier_id: string | null
  truck_id: string | null
  ignore: boolean
}

export const groupLabels: Record<SaleGroup, string> = { file: 'Sales file', manager: 'Manager count', driver: 'Driver count' }

/** Files and Square count as "file" when picking which source wins. */
export const saleGroup = (source: Sale['source']): SaleGroup => (source === 'csv' || source === 'square' ? 'file' : source)

/** The first source in the business's order that has sales (matches app.compare_shift). */
export function winningGroup(sales: Sale[], settings: Settings | null | undefined): SaleGroup | null {
  const order = settings?.sales_source_order ?? ['file', 'manager', 'driver']
  return order.find((g) => sales.some((s) => saleGroup(s.source) === g)) ?? null
}

export function totals(sales: Sale[]) {
  let drinks = 0
  let free = 0
  let money = 0
  for (const s of sales) {
    drinks += Number(s.quantity)
    if (s.is_free) free += Number(s.quantity)
    money += Number(s.price)
  }
  return { drinks, free, money }
}

/** Sales on one shift, every source. */
export function useShiftSales(shiftId: string | undefined) {
  return useLiveQuery({
    tables: ['sales'],
    queryKey: ['sales', 'shift', shiftId],
    enabled: Boolean(shiftId),
    queryFn: async () => {
      const { data, error } = await supabase.from('sales').select('*').eq('shift_id', shiftId!).order('created_at')
      if (error) throw error
      return data as Sale[]
    },
  })
}

/** Sales since a moment, for the sales page. */
export function useSalesSince(since: string) {
  return useLiveQuery({
    tables: ['sales'],
    queryKey: ['sales', 'since', since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('id, truck_id, shift_id, sold_at, quantity, price, is_free, source, product_size_id')
        .gte('sold_at', since)
        .order('sold_at', { ascending: false })
        .limit(10000)
      if (error) throw error
      return data as Sale[]
    },
  })
}

export function useSalesImports() {
  return useLiveQuery({
    tables: ['sales_imports'],
    queryKey: ['sales-imports'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales_imports').select('*').order('created_at', { ascending: false }).limit(30)
      if (error) throw error
      return data as SalesImport[]
    },
  })
}

export const useItemMappings = () => useRows<ItemMapping>('item_mappings', { order: 'kind,outside_key' })
export const useFileFormats = () =>
  useRows<{ id: string; headers_key: string; columns: Record<string, number | string | null> }>('sales_file_formats', { order: 'headers_key' })
