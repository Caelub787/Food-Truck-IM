import { useMe } from '@/features/auth/session'
import type { Movement, StockLevel } from '@/features/inventory/data'
import type { Person } from '@/features/people/people'
import type { Catalog, Supply } from '@/features/setup/data'
import { useRows } from '@/lib/data'
import { useLiveQuery } from '@/lib/live'
import { rpc, supabase } from '@/lib/supabase'

export type Shift = {
  id: string
  truck_id: string
  lead_id: string
  status: 'open' | 'closed' | 'cancelled'
  business_date: string
  event_name: string | null
  notes: string | null
  started_at: string
  start_confirmed_at: string | null
  checklist_done_at: string | null
  end_confirmed_at: string | null
  ended_at: string | null
  count_check_status: 'not_needed' | 'waiting' | 'done' | 'missed'
}
export type CrewRow = { shift_id: string; user_id: string; role: 'lead' | 'crew' }
export type ShiftCount = {
  shift_id: string
  supply_id: string
  kind: 'start' | 'end' | 'check'
  quantity: number
  expected: number | null
  photo_path: string | null
  entered_by: string | null
  client_ts: string
}
export type ShiftResult = {
  id: string
  supply_id: string | null
  group_id: string | null
  start_qty: number
  added_qty: number
  end_qty: number
  waste_qty: number
  actual_qty: number
  expected_qty: number | null
  diff_qty: number | null
  unit_cost: number
  flagged: boolean
  flag_reason: string | null
}
export type WasteLog = {
  id: string
  place_id: string
  shift_id: string | null
  supply_id: string | null
  product_size_id: string | null
  modifier_ids: string[]
  quantity: number
  reason_id: string | null
  note: string | null
  photo_path: string | null
  cost: number
  created_by: string | null
  created_at: string
}
export type TruckPar = { truck_id: string; supply_id: string; par_quantity: number; low_quantity: number | null }
export type OpenShift = { shift_id: string; truck_id: string; lead_id: string; started_at: string; start_confirmed: boolean }

/** Where a shift is: counting at the start, working, wrapping up, or done. */
export function shiftStage(s: Shift): 'start' | 'working' | 'wrapping' | 'closed' | 'cancelled' {
  if (s.status !== 'open') return s.status
  if (!s.start_confirmed_at) return 'start'
  if (!s.end_confirmed_at) return 'working'
  return 'wrapping'
}

export const stageLabels = {
  start: 'Starting count',
  working: 'Working',
  wrapping: 'Wrapping up',
  closed: 'Finished',
  cancelled: 'Cancelled',
} as const

/** Shifts, newest first. Drivers only get the shifts they're on. */
export function useShifts(options: { since?: string; truckId?: string; limit?: number } = {}) {
  return useLiveQuery({
    tables: ['shifts'],
    queryKey: ['shifts', options],
    queryFn: async () => {
      let q = supabase
        .from('shifts')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(options.limit ?? 200)
      if (options.since) q = q.gte('started_at', options.since)
      if (options.truckId) q = q.eq('truck_id', options.truckId)
      const { data, error } = await q
      if (error) throw error
      return data as Shift[]
    },
  })
}

export function useShift(id: string | undefined) {
  return useLiveQuery({
    tables: ['shifts'],
    queryKey: ['shift', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('shifts').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return data as Shift | null
    },
  })
}

/** Rows of a shift table for one shift. */
function useShiftRows<T>(table: string, shiftId: string | undefined, order = 'shift_id', extraTables: string[] = []) {
  return useLiveQuery({
    tables: [table, ...extraTables],
    queryKey: ['shift-rows', table, shiftId],
    enabled: Boolean(shiftId),
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select('*').eq('shift_id', shiftId!).order(order)
      if (error) throw error
      return data as T[]
    },
  })
}

export const useShiftCrew = (shiftId: string | undefined) => useShiftRows<CrewRow>('shift_crew', shiftId, 'role')
export const useShiftCounts = (shiftId: string | undefined) => useShiftRows<ShiftCount>('shift_counts', shiftId, 'supply_id')
export const useShiftResults = (shiftId: string | undefined) => useShiftRows<ShiftResult>('shift_results', shiftId, 'supply_id')
export const useShiftChecklist = (shiftId: string | undefined) =>
  useShiftRows<{ item_id: string; checked_by: string | null }>('shift_checklist', shiftId, 'item_id')
export const useShiftMoves = (shiftId: string | undefined) => useShiftRows<Movement>('stock_movements', shiftId, 'created_at')
export const useShiftWaste = (shiftId: string | undefined) => useShiftRows<WasteLog>('waste_logs', shiftId, 'created_at')

/** Who's on each shift, for lists. */
export const useAllCrew = () => useRows<CrewRow>('shift_crew', { select: 'shift_id, user_id, role', order: 'shift_id' })

/** Trucks with a shift going (everyone can see these, to join one). */
export function useOpenShifts() {
  return useLiveQuery({
    tables: ['shifts', 'shift_crew'],
    queryKey: ['open-shifts'],
    queryFn: () => rpc<OpenShift[]>('open_shifts'),
  })
}

/** The open shift the logged in person is on, if any. */
export function useMyOpenShift() {
  const me = useMe()
  const open = useOpenShifts()
  const userId = me.data?.user_id
  const mine = useLiveQuery({
    tables: ['shift_crew'],
    queryKey: ['my-crew', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('shift_crew').select('shift_id, user_id, role').eq('user_id', userId!)
      if (error) throw error
      return data as CrewRow[]
    },
  })
  const shift = open.data?.find((o) => mine.data?.some((c) => c.shift_id === o.shift_id))
  return { data: shift ?? null, isLoading: open.isLoading || mine.isLoading }
}

export const useTruckPars = () => useRows<TruckPar>('truck_pars', { order: 'truck_id' })

export function useWasteLogs(filters: { since: string; placeId?: string; limit: number }) {
  return useLiveQuery({
    tables: ['waste_logs'],
    queryKey: ['waste', filters],
    queryFn: async () => {
      let q = supabase.from('waste_logs').select('*').gte('created_at', filters.since).order('created_at', { ascending: false }).limit(filters.limit)
      if (filters.placeId) q = q.eq('place_id', filters.placeId)
      const { data, error } = await q
      if (error) throw error
      return data as WasteLog[]
    },
  })
}

/**
 * Supplies that matter on a shift, the same way the database decides: on the
 * truck, counted, moved on this shift, or with a par level for the truck.
 */
export function shiftSupplyIds(opts: {
  truckId: string
  levels: StockLevel[]
  counts: ShiftCount[]
  moves: Movement[]
  pars: TruckPar[]
}) {
  const ids = new Set<string>()
  for (const l of opts.levels) if (l.place_id === opts.truckId && Number(l.quantity) !== 0) ids.add(l.supply_id)
  for (const c of opts.counts) ids.add(c.supply_id)
  for (const m of opts.moves) ids.add(m.supply_id)
  for (const p of opts.pars) if (p.truck_id === opts.truckId && Number(p.par_quantity) > 0) ids.add(p.supply_id)
  return ids
}

/** How much to load: enough to get back up to the par level. */
export function suggestedLoad(par: number | null | undefined, onTruck: number) {
  if (!par) return 0
  return Math.max(0, par - Math.max(0, onTruck))
}

/** People who can work a shift: joined and turned on. */
export const workers = (people: Person[] | undefined) => (people ?? []).filter((p) => p.active && p.joined_at)

/** Supplies sorted by category, then name. */
export function sortSupplies(c: Catalog, ids: Iterable<string>) {
  return [...ids]
    .map((id) => c.supply(id))
    .filter((s): s is Supply => Boolean(s))
    .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name))
}
