import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { TextArea } from '@/components/forms'
import { Button, Field, Notice, Select, Sheet } from '@/components/ui'
import { usePeople } from '@/features/people/people'
import { useTrucks } from '@/features/setup/data'
import { CrewPicker } from '@/features/shifts/CrewPicker'
import { workers } from '@/features/shifts/data'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { clashes, timeText, type Plan } from './data'

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Planning a shift, or changing or cancelling one. */
export function PlanSheet({
  open,
  onClose,
  plan,
  day,
  allPlans,
}: {
  open: boolean
  onClose: () => void
  plan: Plan | null
  day: Date
  allPlans: Plan[]
}) {
  const queryClient = useQueryClient()
  const trucks = useTrucks()
  const people = usePeople()
  const start = plan ? new Date(plan.starts_at) : null
  const end = plan ? new Date(plan.ends_at) : null
  const [form, setForm] = useState({
    truck_id: plan?.truck_id ?? '',
    date: localDate(start ?? day),
    from: start ? localTime(start) : '11:00',
    to: end ? localTime(end) : '18:00',
    lead_id: plan?.lead_id ?? '',
    crew: plan?.crew ?? [],
    event_name: plan?.event_name ?? '',
    place: plan?.place ?? '',
    notes: plan?.notes ?? '',
    repeat_weeks: '0',
  })
  const active = (trucks.data ?? []).filter((t) => t.active)
  const truck = form.truck_id || active[0]?.id || ''
  const startsAt = new Date(`${form.date}T${form.from}`)
  let endsAt = new Date(`${form.date}T${form.to}`)
  if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86400000) // ends after midnight
  const clash = clashes(
    { id: plan?.id ?? '', truck_id: truck, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), lead_id: form.lead_id || null, crew: form.crew },
    allPlans,
  )

  const refresh = () => refreshTables(queryClient, ['schedules', 'schedule_crew'])
  const save = useAction(async () => {
    await rpc('save_schedule', {
      p: {
        id: plan?.id ?? null,
        truck_id: truck,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        lead_id: form.lead_id || null,
        crew_ids: form.crew.filter((c) => c !== form.lead_id),
        event_name: form.event_name,
        place: form.place,
        notes: form.notes,
        repeat_weeks: plan ? 0 : Number(form.repeat_weeks),
      },
    })
    await refresh()
    onClose()
  })
  const cancel = useAction(async (andLater: boolean) => {
    await rpc('cancel_schedule', { p_schedule_id: plan!.id, p_and_later: andLater })
    await refresh()
    onClose()
  })

  return (
    <Sheet title={plan ? 'Change plan' : 'Plan a shift'} open={open} onClose={onClose} wide>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save.run()
        }}
      >
        <Select label="Truck" value={truck} onChange={(e) => setForm({ ...form, truck_id: e.target.value })}>
          {active.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Day" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="col-span-2 sm:col-span-1" />
          <Field label="Starts" type="time" required value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          <Field label="Ends" type="time" required value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        </div>
        <CrewPicker people={workers(people.data)} lead={form.lead_id} onLead={(v) => setForm({ ...form, lead_id: v })} crew={form.crew} onCrew={(v) => setForm({ ...form, crew: v })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Event (optional)" value={form.event_name} maxLength={120} onChange={(e) => setForm({ ...form, event_name: e.target.value })} />
          <Field label="Where (optional)" value={form.place} maxLength={300} onChange={(e) => setForm({ ...form, place: e.target.value })} />
        </div>
        <TextArea label="Notes (optional)" rows={2} value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        {!plan && (
          <Select label="Repeat" value={form.repeat_weeks} onChange={(e) => setForm({ ...form, repeat_weeks: e.target.value })}>
            <option value="0">Just this once</option>
            {[1, 2, 3, 4, 6, 8, 12].map((n) => (
              <option key={n} value={n}>
                Every week for {n + 1} weeks
              </option>
            ))}
          </Select>
        )}
        {clash.length > 0 && (
          <Notice tone="warning">
            This overlaps with {clash.length === 1 ? 'another plan' : `${clash.length} other plans`} for the same truck or person (
            {clash.map((c) => `${timeText(c.starts_at)} to ${timeText(c.ends_at)}`).join(', ')}). You can still save it.
          </Notice>
        )}
        {(save.error || cancel.error) && <Notice tone="error">{save.error ?? cancel.error}</Notice>}
        <Button type="submit" busy={save.busy} full>
          {plan ? 'Save changes' : 'Plan it'}
        </Button>
        {plan && plan.status === 'planned' && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <ConfirmButton variant="secondary" confirmLabel="Tap again to cancel it" busy={cancel.busy} onConfirm={() => void cancel.run(false)} className="flex-1">
              Cancel this plan
            </ConfirmButton>
            {plan.series_id && (
              <ConfirmButton variant="secondary" confirmLabel="Tap again to cancel them" busy={cancel.busy} onConfirm={() => void cancel.run(true)} className="flex-1">
                Cancel this and later weeks
              </ConfirmButton>
            )}
          </div>
        )}
      </form>
    </Sheet>
  )
}
