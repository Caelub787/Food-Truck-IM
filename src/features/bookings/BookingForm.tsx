import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { TextArea } from '@/components/forms'
import { Button, Field, Notice, Select } from '@/components/ui'
import { LinesEditor } from '@/features/inventory/LinesEditor'
import { newLine, type StockLine } from '@/features/inventory/stockLines'
import { usePeople } from '@/features/people/people'
import { clashes, timeText, usePlans } from '@/features/schedule/data'
import { useSupplyCatalog, useTrucks } from '@/features/setup/data'
import { CrewPicker } from '@/features/shifts/CrewPicker'
import { workers } from '@/features/shifts/data'
import { num } from '@/lib/data'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { clean, findUnit } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import type { Booking, BookingSupply } from './data'

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * Accepting a booking (or changing one that's booked): the time, place, truck,
 * Lead and crew, manager in charge, on site contact, what to bring, and notes.
 */
export function BookingForm({
  booking,
  supplies,
  scheduleCrew,
  scheduleLead,
  onDone,
}: {
  booking: Booking
  supplies: BookingSupply[]
  scheduleCrew: string[]
  scheduleLead: string | null
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const trucks = useTrucks()
  const people = usePeople()
  const catalog = useSupplyCatalog()
  const editing = booking.status === 'accepted'
  const start = new Date(booking.starts_at)
  const end = new Date(booking.ends_at)
  const [form, setForm] = useState({
    date: localDate(start),
    from: localTime(start),
    to: localTime(end),
    event_name: booking.event_name ?? booking.organization ?? '',
    place: booking.place,
    truck_id: booking.truck_id ?? '',
    lead_id: scheduleLead ?? '',
    crew: scheduleCrew,
    manager_id: booking.manager_id ?? '',
    contact_name: booking.contact_name ?? (editing ? '' : booking.client_name),
    contact_phone: booking.contact_phone ?? (editing ? '' : (booking.client_phone ?? '')),
    crew_notes: booking.crew_notes ?? '',
    price: booking.price != null ? String(booking.price) : '',
    message: '',
  })
  const [lines, setLines] = useState<StockLine[]>(() =>
    supplies.map((l) => {
      const s = catalog.data?.supply(l.supply_id)
      const unit = s ? findUnit(catalog.data!.unitsOf(s.id), s.count_unit_id) : { id: null, factor: 1 }
      return newLine({ supply_id: l.supply_id, unit_id: unit.id ?? '', amount: String(clean(Number(l.quantity) / unit.factor, 4)) })
    }),
  )
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  const active = (trucks.data ?? []).filter((t) => t.active)
  const truck = form.truck_id || active[0]?.id || ''
  const startsAt = new Date(`${form.date}T${form.from}`)
  let endsAt = new Date(`${form.date}T${form.to}`)
  if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86400000)
  const dayStart = new Date(`${form.date}T00:00`)
  const plans = usePlans(new Date(dayStart.getTime() - 86400000), new Date(dayStart.getTime() + 2 * 86400000))
  const clash = clashes(
    { id: booking.schedule_id ?? '', truck_id: truck, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), lead_id: form.lead_id || null, crew: form.crew },
    plans.data ?? [],
  )
  const managers = (people.data ?? []).filter((p) => p.active && (p.role === 'admin' || p.role === 'manager'))

  const save = useAction(async () => {
    const c = catalog.data!
    const p = {
      booking_id: booking.id,
      truck_id: truck,
      lead_id: form.lead_id || null,
      crew_ids: form.crew.filter((x) => x !== form.lead_id),
      manager_id: form.manager_id || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      event_name: form.event_name,
      place: form.place,
      contact_name: form.contact_name,
      contact_phone: form.contact_phone,
      crew_notes: form.crew_notes,
      price: num(form.price),
      supplies: lines
        .filter((l) => l.supply_id && (num(l.amount) ?? 0) > 0)
        .map((l) => ({ supply_id: l.supply_id, quantity: num(l.amount)! * findUnit(c.unitsOf(l.supply_id), l.unit_id || null).factor })),
    }
    if (editing) await rpc('update_booking', { p })
    else await rpc('decide_booking', { p: { ...p, action: 'accept', message: form.message } })
    await refreshTables(queryClient, ['bookings', 'booking_supplies', 'schedules', 'schedule_crew'])
    onDone()
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save.run()
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Day" type="date" required value={form.date} onChange={set('date')} className="col-span-2 sm:col-span-1" />
        <Field label="Starts" type="time" required value={form.from} onChange={set('from')} />
        <Field label="Ends" type="time" required value={form.to} onChange={set('to')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Event" value={form.event_name} maxLength={120} onChange={set('event_name')} />
        <Field label="Where" required value={form.place} maxLength={300} onChange={set('place')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Truck" value={truck} onChange={set('truck_id')}>
          {active.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select label="Manager in charge" value={form.manager_id} onChange={set('manager_id')}>
          <option value="">None</option>
          {managers.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name}
            </option>
          ))}
        </Select>
      </div>
      <CrewPicker people={workers(people.data)} lead={form.lead_id} onLead={(v) => setForm({ ...form, lead_id: v })} crew={form.crew} onCrew={(v) => setForm({ ...form, crew: v })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="On site contact" value={form.contact_name} maxLength={120} onChange={set('contact_name')} />
        <Field label="Contact phone" type="tel" value={form.contact_phone} maxLength={40} onChange={set('contact_phone')} />
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700">Bring for this event (optional)</p>
        <p className="mb-2 text-sm text-slate-500">These amounts fill in the truck's loading list for this shift.</p>
        {catalog.data && (
          <LinesEditor
            catalog={catalog.data}
            lines={lines}
            onChange={setLines}
            // Amounts start in the unit drivers count in, like sleeves or bags.
            onSupplyPicked={(_, id) => ({ unit_id: findUnit(catalog.data!.unitsOf(id), catalog.data!.supply(id)?.count_unit_id).id ?? '' })}
          />
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Price agreed ($, optional)" inputMode="decimal" value={form.price} onChange={set('price')} hint="Shows in the budget as event income." />
      </div>
      <TextArea label="Notes for the crew (optional)" rows={2} maxLength={2000} value={form.crew_notes} onChange={set('crew_notes')} />
      {!editing && (
        <TextArea
          label="Message to the client (optional)"
          hint="Goes in their confirmation email."
          rows={2}
          maxLength={2000}
          value={form.message}
          onChange={set('message')}
        />
      )}
      {clash.length > 0 && (
        <Notice tone="warning">
          This overlaps with {clash.length === 1 ? 'another plan' : `${clash.length} other plans`} for the same truck or person (
          {clash.map((c) => `${timeText(c.starts_at)} to ${timeText(c.ends_at)}`).join(', ')}). You can still save it.
        </Notice>
      )}
      {save.error && <Notice tone="error">{save.error}</Notice>}
      <Button type="submit" busy={save.busy} full>
        {editing ? 'Save and tell the crew' : 'Accept and tell everyone'}
      </Button>
    </form>
  )
}
