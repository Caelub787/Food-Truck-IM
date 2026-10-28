import { useLiveQuery } from './live'
import { supabase } from './supabase'

// Reading and writing company tables. Security rules in the database decide who
// can see and change what, so these stay simple.

/** Every row of a company table, kept live. */
export function useRows<T>(table: string, options: { select?: string; order?: string; tables?: string[]; enabled?: boolean } = {}) {
  const select = options.select ?? '*'
  const order = options.order ?? 'name'
  return useLiveQuery({
    tables: options.tables ?? [table],
    queryKey: ['rows', table, select, order],
    enabled: options.enabled,
    queryFn: async () => {
      let query = supabase.from(table).select(select)
      for (const part of order.split(',').filter(Boolean)) {
        const [column, direction] = part.trim().split(' ')
        query = query.order(column!, { ascending: direction !== 'desc' })
      }
      const { data, error } = await query
      if (error) throw error
      return data as T[]
    },
  })
}

export async function insertRow<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.from(table).insert(row).select().single()
  if (error) throw error
  return data as T
}

export async function updateRow(table: string, id: string, patch: Record<string, unknown>, idColumn = 'id') {
  const { error } = await supabase.from(table).update(patch).eq(idColumn, id)
  if (error) throw error
}

export async function deleteRow(table: string, id: string, idColumn = 'id') {
  const { error } = await supabase.from(table).delete().eq(idColumn, id)
  if (error) throw error
}

/** Text to number, or null when empty. */
export function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
