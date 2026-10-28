import { useLiveQuery } from '@/lib/live'
import { rpc } from '@/lib/supabase'

export type ReportShift = {
  id: string
  truck_id: string
  lead_id: string
  business_date: string
  event_name: string | null
  count_check_status: string
  drinks: number
  free: number
  revenue: number
  used: number
  waste: number
  off_cost: number
  flagged: number
  source: 'file' | 'manager' | 'driver' | null
}
export type Report = {
  totals: { shifts: number; drinks: number; free: number; revenue: number; used: number; shift_waste: number; off_cost: number; flagged_shifts: number; all_waste: number }
  shifts: ReportShift[]
  supplies: { supply_id: string | null; group_id: string | null; actual: number; expected: number | null; diff: number | null; cost: number | null; shifts: number }[]
  waste_reasons: { reason_id: string | null; count: number; cost: number }[]
  waste_supplies: { supply_id: string; quantity: number; cost: number }[]
  free_reasons: { reason_id: string | null; drinks: number; cost: number }[]
  drivers: { user_id: string; shifts: number; drinks: number; revenue: number; used: number; waste: number; off_cost: number; flagged_shifts: number }[]
  count_checks: { done: number; missed: number; waiting: number; different: number }
  days: { date: string; shifts: number; drinks: number; revenue: number; used: number; waste: number }[]
}

/** Everything for the reports screen over a stretch of time, kept live. */
export function useReport(from: Date, to: Date, truckId: string) {
  return useLiveQuery({
    tables: ['shifts', 'shift_results', 'sales', 'waste_logs', 'shift_counts'],
    queryKey: ['report', from.toISOString(), to.toISOString(), truckId],
    queryFn: () => rpc<Report>('report', { p_from: from.toISOString(), p_to: to.toISOString(), p_truck: truckId || null }),
  })
}

export type Period = 'week' | 'month30' | 'this_month' | 'last_month' | 'days90'
export const periods: Record<Period, string> = {
  week: 'Last 7 days',
  month30: 'Last 30 days',
  this_month: 'This month',
  last_month: 'Last month',
  days90: 'Last 90 days',
}

/** The start and end of a period, in local time. */
export function periodRange(p: Period, now = new Date()): [Date, Date] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 86400000)
  const back = (days: number) => new Date(tomorrow.getTime() - days * 86400000)
  switch (p) {
    case 'week':
      return [back(7), tomorrow]
    case 'month30':
      return [back(30), tomorrow]
    case 'days90':
      return [back(90), tomorrow]
    case 'this_month':
      return [new Date(today.getFullYear(), today.getMonth(), 1), tomorrow]
    case 'last_month':
      return [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 1)]
  }
}
