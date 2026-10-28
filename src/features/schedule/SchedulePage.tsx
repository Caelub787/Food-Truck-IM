import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Badge, Button, PageHeader, Spinner } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { usePeopleNames } from '@/features/inventory/data'
import { useTrucks } from '@/features/setup/data'
import { useShifts } from '@/features/shifts/data'
import { addDays, timeText, usePlans, weekStart, type Plan } from './data'
import { PlanSheet } from './PlanSheet'

/**
 * The week's plan: who works which truck and when. Managers plan and change
 * it. Drivers see the shifts they're on, and start them from here.
 */
export function SchedulePage() {
  const me = useMeLoaded()
  const navigate = useNavigate()
  const isManager = me.profile?.role !== 'driver'
  const [start, setStart] = useState(() => weekStart(new Date()))
  const end = addDays(start, 7)
  const plans = usePlans(start, end)
  const shifts = useShifts({ since: addDays(start, -1).toISOString(), limit: 300 })
  const trucks = useTrucks()
  const name = usePeopleNames()
  const [editing, setEditing] = useState<{ id: string | null; day: Date } | null>(null)
  const [today] = useState(() => new Date().toDateString())

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const truckName = (id: string) => trucks.data?.find((t) => t.id === id)?.name ?? 'Truck'
  const started = (p: Plan) => (shifts.data ?? []).find((s) => s.schedule_id === p.id)
  const mine = (p: Plan) => p.lead_id === me.user_id || p.crew.includes(me.user_id)
  const label = `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} to ${addDays(start, 6).toLocaleDateString([], { month: 'short', day: 'numeric' })}`

  const card = (p: Plan) => {
    const shift = started(p)
    const isToday = new Date(p.starts_at).toDateString() === today
    const crewNames = p.crew.map(name).filter(Boolean)
    return (
      <div
        key={p.id}
        className={`rounded-xl border p-3 ${p.status === 'cancelled' ? 'border-slate-200 bg-slate-50 opacity-60' : mine(p) ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'}`}
      >
        <button
          type="button"
          disabled={!isManager}
          onClick={() => setEditing({ id: p.id, day: new Date(p.starts_at) })}
          className="w-full text-left disabled:cursor-default"
        >
          <p className={`font-semibold ${p.status === 'cancelled' ? 'line-through' : ''}`}>
            {timeText(p.starts_at)} to {timeText(p.ends_at)}
          </p>
          <p className="font-medium text-slate-800">{truckName(p.truck_id)}</p>
          {p.event_name && <p className="text-sm text-slate-600">{p.event_name}</p>}
          {p.place && <p className="text-sm text-slate-500">{p.place}</p>}
          <p className="mt-1 text-sm text-slate-600">
            {p.lead_id ? `Lead: ${name(p.lead_id)}` : 'No Lead yet'}
            {crewNames.length > 0 && ` · ${crewNames.join(', ')}`}
          </p>
          {p.notes && <p className="mt-1 text-sm text-slate-500">{p.notes}</p>}
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {p.status === 'cancelled' && <Badge>Cancelled</Badge>}
          {shift && (
            <button onClick={() => navigate(`/shifts/${shift.id}`)} className="text-sm font-semibold text-brand-700">
              <Badge tone="green">Started</Badge> Open shift
            </button>
          )}
          {!shift && p.status === 'planned' && isToday && (isManager || mine(p)) && (
            <Button variant="secondary" className="min-h-11" onClick={() => navigate(`/shifts?start=1&plan=${p.id}`)}>
              Start shift
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle={isManager ? 'Plan who works which truck and when. Everyone sees their own shifts live.' : 'Your planned shifts.'}
        action={
          isManager ? (
            <Button className="shrink-0" onClick={() => setEditing({ id: null, day: new Date() })}>
              <Plus className="size-5" aria-hidden /> Plan
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="secondary" aria-label="Last week" onClick={() => setStart(addDays(start, -7))}>
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
        <div className="text-center">
          <p className="font-semibold">{label}</p>
          <button className="text-sm font-medium text-brand-700" onClick={() => setStart(weekStart(new Date()))}>
            This week
          </button>
        </div>
        <Button variant="secondary" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}>
          <ChevronRight className="size-5" aria-hidden />
        </Button>
      </div>

      {!plans.data ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 lg:grid-cols-7">
          {days.map((d) => {
            const list = plans.data.filter((p) => new Date(p.starts_at).toDateString() === d.toDateString())
            const isToday = d.toDateString() === today
            return (
              <section key={d.toISOString()} aria-label={d.toDateString()} className="min-w-0">
                <div className="mb-2 flex items-center justify-between lg:block">
                  <h2 className={`font-semibold ${isToday ? 'text-brand-700' : ''}`}>
                    {d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                    {isToday && ' (today)'}
                  </h2>
                  {isManager && (
                    <button onClick={() => setEditing({ id: null, day: d })} className="min-h-11 px-2 text-sm font-medium text-brand-700 lg:min-h-0 lg:px-0">
                      + Add
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {list.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-3 text-sm text-slate-400">Nothing planned</p> : list.map(card)}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {editing && (
        <PlanSheet
          key={editing.id ?? editing.day.toISOString()}
          open
          onClose={() => setEditing(null)}
          plan={editing.id ? (plans.data?.find((p) => p.id === editing.id) ?? null) : null}
          day={editing.day}
          allPlans={plans.data ?? []}
        />
      )}
    </div>
  )
}
