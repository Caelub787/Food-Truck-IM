import { Play, Truck as TruckIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { EmptyState } from '@/components/forms'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Button, Card, Notice, PageHeader, Select, Spinner } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { usePeopleNames } from '@/features/inventory/data'
import { useTrucks } from '@/features/setup/data'
import { rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { shiftStage, stageLabels, useAllCrew, useMyOpenShift, useOpenShifts, useShifts, type Shift } from './data'
import { StartShiftSheet } from './StartShiftSheet'

export function ShiftsPage() {
  const me = useMeLoaded()
  const navigate = useNavigate()
  const isManager = me.profile?.role !== 'driver'
  const [truckFilter, setTruckFilter] = useState('')
  const [params, setParams] = useSearchParams()
  const starting = params.get('start') === '1'
  const setStarting = (on: boolean) => setParams(on ? { start: '1' } : {}, { replace: true })
  const shifts = useShifts({ truckId: truckFilter || undefined, limit: 150 })
  const trucks = useTrucks()
  const name = usePeopleNames()
  const truckName = (id: string) => trucks.data?.find((t) => t.id === id)?.name ?? 'Truck'
  const past = (shifts.data ?? []).filter((s) => s.status !== 'open')
  const date = (s: Shift) => new Date(`${s.business_date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div>
      <PageHeader
        title="Shifts"
        subtitle={isManager ? 'Every shift on every truck, live.' : 'Your shifts and trucks that are out now.'}
        action={
          <Button onClick={() => setStarting(true)} className="shrink-0">
            <Play className="size-5" aria-hidden /> Start
          </Button>
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <MyShiftCard onStart={() => setStarting(true)} />
        <GoingNow />
      </div>

      <div className="mt-8 mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-bold">Past shifts</h2>
        {isManager && (trucks.data?.length ?? 0) > 1 && (
          <Select label="Truck" value={truckFilter} onChange={(e) => setTruckFilter(e.target.value)} className="sm:w-56">
            <option value="">All trucks</option>
            {(trucks.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {shifts.isLoading && <Spinner />}
      {shifts.data && past.length === 0 && <EmptyState title="No finished shifts yet">They show up here with what each one used.</EmptyState>}
      {past.length > 0 && (
        <ResponsiveList
          rows={past}
          rowKey={(s) => s.id}
          title={(s) => `${truckName(s.truck_id)} · ${date(s)}`}
          subtitle={(s) => [`Lead: ${name(s.lead_id)}`, s.event_name].filter(Boolean).join(' · ')}
          badge={(s) => <Badge tone={s.status === 'closed' ? 'green' : 'gray'}>{stageLabels[shiftStage(s)]}</Badge>}
          columns={[
            { label: 'Date', cell: date, className: 'whitespace-nowrap' },
            { label: 'Truck', cell: (s) => <span className="font-medium">{truckName(s.truck_id)}</span> },
            { label: 'Lead', cell: (s) => name(s.lead_id) },
            { label: 'Event', cell: (s) => s.event_name ?? '' },
            {
              label: 'Hours',
              cell: (s) =>
                s.ended_at ? `${new Date(s.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to ${new Date(s.ended_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '',
              className: 'whitespace-nowrap',
            },
            { label: 'Status', cell: (s) => <Badge tone={s.status === 'closed' ? 'green' : 'gray'}>{stageLabels[shiftStage(s)]}</Badge> },
          ]}
          onSelect={(s) => navigate(`/shifts/${s.id}`)}
          actionLabel="Open"
        />
      )}
      <StartShiftSheet open={starting} onClose={() => setStarting(false)} />
    </div>
  )
}

/** The shift you're on right now, or a button to start one. */
export function MyShiftCard({ onStart }: { onStart: () => void }) {
  const mine = useMyOpenShift()
  const trucks = useTrucks()
  const navigate = useNavigate()
  if (mine.isLoading) return null
  if (!mine.data) {
    return (
      <Card>
        <h2 className="font-semibold">You're not on a shift</h2>
        <p className="mt-1 text-slate-600">Starting a truck? Start a shift. If someone already started yours, join it.</p>
        <Button className="mt-3" onClick={onStart}>
          <Play className="size-5" aria-hidden /> Start a shift
        </Button>
      </Card>
    )
  }
  const s = mine.data
  return (
    <Card className="border-brand-200 bg-brand-50">
      <div className="flex items-start gap-3">
        <TruckIcon className="mt-0.5 size-6 shrink-0 text-brand-700" aria-hidden />
        <div className="flex-1">
          <h2 className="font-semibold">You're on {trucks.data?.find((t) => t.id === s.truck_id)?.name ?? 'a truck'}</h2>
          <p className="text-slate-600">
            Started {new Date(s.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.{' '}
            {s.start_confirmed ? 'Starting count is done.' : 'Starting count is next.'}
          </p>
          <Button className="mt-3" onClick={() => navigate(`/shifts/${s.shift_id}`)}>
            Continue shift
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** Trucks out right now. Join one you're working on. */
export function GoingNow() {
  const me = useMeLoaded()
  const open = useOpenShifts()
  const crew = useAllCrew()
  const trucks = useTrucks()
  const name = usePeopleNames()
  const navigate = useNavigate()
  const join = useAction(async (shiftId: string) => {
    await rpc('join_shift', { p_shift_id: shiftId })
    navigate(`/shifts/${shiftId}`)
  })
  const isManager = me.profile?.role !== 'driver'
  const onIt = (shiftId: string) => isManager || (crew.data ?? []).some((c) => c.shift_id === shiftId && c.user_id === me.user_id)

  return (
    <Card>
      <h2 className="font-semibold">Out now</h2>
      {!open.data ? (
        <Spinner />
      ) : open.data.length === 0 ? (
        <p className="mt-1 text-slate-600">No trucks are out right now.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {open.data.map((o) => (
            <li key={o.shift_id} className="flex min-h-16 items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-medium">{trucks.data?.find((t) => t.id === o.truck_id)?.name ?? 'Truck'}</p>
                <p className="truncate text-sm text-slate-500">
                  Lead: {name(o.lead_id)} · since {new Date(o.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
              {onIt(o.shift_id) ? (
                <Button variant="secondary" onClick={() => navigate(`/shifts/${o.shift_id}`)}>
                  Open
                </Button>
              ) : (
                <Button variant="secondary" busy={join.busy} onClick={() => void join.run(o.shift_id)}>
                  Join
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {join.error && <Notice tone="error">{join.error}</Notice>}
    </Card>
  )
}
