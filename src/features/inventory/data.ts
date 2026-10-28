import { useLocations, useTrucks } from '@/features/setup/data'
import { useRows } from '@/lib/data'
import { useLiveQuery } from '@/lib/live'
import { supabase } from '@/lib/supabase'

export type StockLevel = { place_id: string; supply_id: string; quantity: number; updated_at: string }
export type Batch = { id: string; place_id: string; supply_id: string; expires_on: string | null; received_on: string; quantity: number }
export type Movement = {
  id: string
  supply_id: string
  quantity: number
  kind: 'delivery' | 'load' | 'return' | 'waste' | 'usage' | 'transfer' | 'adjustment' | 'correction'
  from_place_id: string | null
  to_place_id: string | null
  unit_cost: number
  shift_id: string | null
  reason: string | null
  note: string | null
  created_by: string | null
  created_at: string
}
export type Place = { id: string; name: string; kind: 'location' | 'truck'; active: boolean; detail: string }

export const movementLabels: Record<Movement['kind'], string> = {
  delivery: 'Delivery',
  load: 'Loaded on truck',
  return: 'Returned to warehouse',
  waste: 'Waste',
  usage: 'Used on shift',
  transfer: 'Moved',
  adjustment: 'Adjusted',
  correction: 'Correction',
}

export const useStockLevels = () => useRows<StockLevel>('stock_levels', { order: 'place_id' })
export const useBatches = () => useRows<Batch>('stock_batches', { order: 'expires_on' })

/** Locations first, then trucks, each with a short description. */
export function usePlaces() {
  const locations = useLocations()
  const trucks = useTrucks()
  const data: Place[] | undefined =
    locations.data && trucks.data
      ? [
          ...locations.data.map<Place>((l) => ({ id: l.id, name: l.name, kind: 'location', active: l.active, detail: l.kind })),
          ...trucks.data.map<Place>((t) => ({ id: t.id, name: t.name, kind: 'truck', active: t.active, detail: 'truck' })),
        ]
      : undefined
  return { data, isLoading: locations.isLoading || trucks.isLoading, name: (id: string | null) => data?.find((p) => p.id === id)?.name ?? '' }
}

/** The latest stock moves, newest first, with optional filters. */
export function useMovements(filters: { placeId?: string; supplyId?: string; kind?: string; since?: string; limit: number }) {
  return useLiveQuery({
    tables: ['stock_movements'],
    queryKey: ['movements', filters],
    queryFn: async () => {
      let q = supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(filters.limit)
      if (filters.placeId) q = q.or(`from_place_id.eq.${filters.placeId},to_place_id.eq.${filters.placeId}`)
      if (filters.supplyId) q = q.eq('supply_id', filters.supplyId)
      if (filters.kind) q = q.eq('kind', filters.kind)
      if (filters.since) q = q.gte('created_at', filters.since)
      const { data, error } = await q
      if (error) throw error
      return data as Movement[]
    },
  })
}

/** Everyone's names, for "who did it". */
export function usePeopleNames() {
  const people = useRows<{ user_id: string; full_name: string }>('profiles', { select: 'user_id, full_name', order: 'full_name' })
  return (id: string | null) => people.data?.find((p) => p.user_id === id)?.full_name ?? ''
}

export function daysUntil(date: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 86400000)
}

export function newClientId() {
  return crypto.randomUUID()
}
