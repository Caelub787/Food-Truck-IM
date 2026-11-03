import { useQueryClient } from '@tanstack/react-query'
import { Mail, MapPin, Phone } from 'lucide-react'
import { useState } from 'react'
import { Toggle, TextArea } from '@/components/forms'
import { Badge, Button, Notice, Sheet } from '@/components/ui'
import { usePeopleNames } from '@/features/inventory/data'
import { usePlan } from '@/features/schedule/data'
import { useSupplyCatalog, useTrucks } from '@/features/setup/data'
import { refreshTables } from '@/lib/live'
import { formatMoney } from '@/lib/units'
import { rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { BookingForm } from './BookingForm'
import { mapLink, statusLabels, whenText, type Booking, type BookingSupply } from './data'
import { EventDetails } from './EventDetails'

const tones = { pending: 'amber', accepted: 'green', declined: 'gray', cancelled: 'gray' } as const

/** One booking: what the client asked for, and accepting, declining, changing, or cancelling it. */
export function BookingSheet({ booking, supplies, onClose }: { booking: Booking; supplies: BookingSupply[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'view' | 'accept' | 'decline' | 'cancel'>('view')
  const [message, setMessage] = useState('')
  const [tellClient, setTellClient] = useState(true)
  const plan = usePlan(booking.schedule_id)
  const catalog = useSupplyCatalog()
  const trucks = useTrucks()
  const name = usePeopleNames()
  const refresh = () => refreshTables(queryClient, ['bookings', 'booking_supplies', 'schedules', 'schedule_crew'])

  const decline = useAction(async () => {
    await rpc('decide_booking', { p: { booking_id: booking.id, action: 'decline', message } })
    await refresh()
    onClose()
  })
  const cancel = useAction(async () => {
    await rpc('cancel_booking', { p_booking_id: booking.id, p_message: message, p_tell_client: tellClient })
    await refresh()
    onClose()
  })
  const title = booking.event_name || booking.organization || booking.client_name
  const past = new Date(booking.ends_at) < new Date()

  return (
    <Sheet title={title} open onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tones[booking.status]}>{statusLabels[booking.status]}</Badge>
          <span className="font-semibold">{whenText(booking)}</span>
          {booking.status === 'pending' && past && <Badge tone="red">Date passed</Badge>}
        </div>

        <section className="rounded-xl bg-slate-50 p-4">
          <h3 className="font-semibold">From the client</h3>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <p>
              <strong>{booking.client_name}</strong>
              {booking.organization && <>, {booking.organization}</>}
            </p>
            <a href={`mailto:${booking.client_email}`} className="flex min-h-10 items-center gap-2 font-medium text-brand-700 hover:underline">
              <Mail className="size-4" aria-hidden /> {booking.client_email}
            </a>
            {booking.client_phone && (
              <a href={`tel:${booking.client_phone}`} className="flex min-h-10 items-center gap-2 font-medium text-brand-700 hover:underline">
                <Phone className="size-4" aria-hidden /> {booking.client_phone}
              </a>
            )}
            <a href={mapLink(booking.place)} target="_blank" rel="noreferrer" className="flex min-h-10 items-start gap-2 font-medium text-brand-700 hover:underline">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {booking.place}
            </a>
            {booking.guests !== null && <p>About {booking.guests} people</p>}
            {booking.client_notes && <p className="whitespace-pre-line text-slate-600">"{booking.client_notes}"</p>}
            <p className="text-slate-500">Asked {new Date(booking.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </div>
        </section>

        {booking.status === 'accepted' && mode === 'view' && (
          <section>
            <h3 className="font-semibold">The plan</h3>
            <p className="mt-1 text-sm text-slate-600">
              {trucks.data?.find((t) => t.id === booking.truck_id)?.name ?? 'Truck'}
              {plan.data?.lead_id && <> · Lead: {name(plan.data.lead_id)}</>}
              {plan.data && plan.data.crew.length > 0 && <> · Crew: {plan.data.crew.map(name).join(', ')}</>}
              {booking.price != null && <> · {formatMoney(Number(booking.price))}</>}
            </p>
            <div className="mt-3">
              <EventDetails event={{ booking, supplies }} catalog={catalog.data} name={name} />
            </div>
          </section>
        )}

        {booking.decision_message && booking.status !== 'pending' && (
          <Notice>
            {booking.status === 'accepted' ? 'Message sent with the confirmation' : 'Message to the client'}: {booking.decision_message}
          </Notice>
        )}

        {mode === 'accept' && (
          <BookingForm
            booking={booking}
            supplies={supplies}
            scheduleLead={plan.data?.lead_id ?? null}
            scheduleCrew={plan.data?.crew ?? []}
            onDone={onClose}
          />
        )}

        {(mode === 'decline' || mode === 'cancel') && (
          <div className="flex flex-col gap-3">
            <TextArea
              label={mode === 'decline' ? 'Message to the client (optional)' : 'Why it was cancelled (optional)'}
              hint={mode === 'decline' ? 'Goes in the email telling them you can\'t make it.' : undefined}
              rows={3}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {mode === 'cancel' && <Toggle label="Email the client" checked={tellClient} onChange={setTellClient} />}
            {(decline.error || cancel.error) && <Notice tone="error">{decline.error ?? cancel.error}</Notice>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="danger"
                busy={decline.busy || cancel.busy}
                onClick={() => void (mode === 'decline' ? decline.run() : cancel.run())}
                className="flex-1"
              >
                {mode === 'decline' ? 'Decline and tell the client' : 'Cancel the booking'}
              </Button>
              <Button variant="secondary" onClick={() => setMode('view')} className="flex-1">
                Back
              </Button>
            </div>
          </div>
        )}

        {mode === 'view' && booking.status === 'pending' && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => setMode('accept')} className="flex-1">
              Accept
            </Button>
            <Button variant="secondary" onClick={() => setMode('decline')} className="flex-1">
              Decline
            </Button>
          </div>
        )}
        {mode === 'view' && booking.status === 'accepted' && !past && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" onClick={() => setMode('accept')} className="flex-1">
              Change
            </Button>
            <Button variant="secondary" onClick={() => setMode('cancel')} className="flex-1">
              Cancel booking
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
