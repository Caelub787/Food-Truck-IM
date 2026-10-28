import { useLiveQuery } from '@/lib/live'
import { supabase } from '@/lib/supabase'

export type Plan = {
  id: string
  truck_id: string
  starts_at: string
  ends_at: string
  event_name: string | null
  place: string | null
  notes: string | null
  lead_id: string | null
  status: 'planned' | 'cancelled'
  series_id: string | null
  crew: string[]
}

/** Plans starting in a stretch of time, with who's on each. */
export function usePlans(from: Date, to: Date) {
  return useLiveQuery({
    tables: ['schedules', 'schedule_crew'],
    queryKey: ['plans', from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedules')
        .select('*')
        .gte('starts_at', from.toISOString())
        .lt('starts_at', to.toISOString())
        .order('starts_at')
      if (error) throw error
      const plans = data as Omit<Plan, 'crew'>[]
      if (plans.length === 0) return [] as Plan[]
      const { data: crew, error: crewError } = await supabase
        .from('schedule_crew')
        .select('schedule_id, user_id')
        .in(
          'schedule_id',
          plans.map((p) => p.id),
        )
      if (crewError) throw crewError
      const rows = crew as { schedule_id: string; user_id: string }[]
      return plans.map((p) => ({ ...p, crew: rows.filter((c) => c.schedule_id === p.id).map((c) => c.user_id) }))
    },
  })
}

/** Monday 00:00 of the week a day is in (local time). */
export function weekStart(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

export const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** "11 AM" or "11:30 AM". */
export const timeText = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined })
}

/** Plans that clash with this one: the same truck, or the same person, at the same time. */
export function clashes(plan: Pick<Plan, 'id' | 'truck_id' | 'starts_at' | 'ends_at' | 'lead_id' | 'crew'>, all: Plan[]) {
  const people = new Set([plan.lead_id, ...plan.crew].filter(Boolean))
  const a = Date.parse(plan.starts_at)
  const b = Date.parse(plan.ends_at)
  return all.filter(
    (p) =>
      p.id !== plan.id &&
      p.status === 'planned' &&
      Date.parse(p.starts_at) < b &&
      a < Date.parse(p.ends_at) &&
      (p.truck_id === plan.truck_id || [p.lead_id, ...p.crew].some((u) => u && people.has(u))),
  )
}

/** One plan with its crew (for starting a shift from it). */
export function usePlan(id: string | null) {
  return useLiveQuery({
    tables: ['schedules', 'schedule_crew'],
    queryKey: ['plan', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('schedules').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      if (!data) return null
      const { data: crew, error: crewError } = await supabase.from('schedule_crew').select('user_id').eq('schedule_id', id!)
      if (crewError) throw crewError
      return { ...(data as Omit<Plan, 'crew'>), crew: (crew as { user_id: string }[]).map((c) => c.user_id) } as Plan
    },
  })
}
