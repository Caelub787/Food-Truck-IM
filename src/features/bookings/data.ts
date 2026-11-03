import { useLiveQuery } from '@/lib/live'
import { supabase } from '@/lib/supabase'

export type BookingStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'

export type Booking = {
  id: string
  status: BookingStatus
  starts_at: string
  ends_at: string
  client_name: string
  client_email: string
  client_phone: string | null
  organization: string | null
  event_name: string | null
  place: string
  guests: number | null
  client_notes: string | null
  truck_id: string | null
  manager_id: string | null
  schedule_id: string | null
  contact_name: string | null
  contact_phone: string | null
  crew_notes: string | null
  price: number | null
  decision_message: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export type BookingSupply = { booking_id: string; supply_id: string; quantity: number }

export const statusLabels: Record<BookingStatus, string> = {
  pending: 'Waiting',
  accepted: 'Booked',
  declined: 'Declined',
  cancelled: 'Cancelled',
}

/** Every booking the person can see, newest event first, with what each one needs. */
export function useBookings() {
  return useLiveQuery({
    tables: ['bookings', 'booking_supplies'],
    queryKey: ['bookings'],
    queryFn: async () => {
      const [bookings, supplies] = await Promise.all([
        supabase.from('bookings').select('*').order('starts_at', { ascending: false }).limit(500),
        supabase.from('booking_supplies').select('booking_id, supply_id, quantity'),
      ])
      if (bookings.error) throw bookings.error
      if (supplies.error) throw supplies.error
      return { bookings: bookings.data as Booking[], supplies: supplies.data as BookingSupply[] }
    },
  })
}

export type EventInfo = { booking: Booking; supplies: BookingSupply[] }

/** The booked events behind these plans (for the schedule and the shift screen). */
export function useEvents(scheduleIds: (string | null | undefined)[]) {
  const ids = [...new Set(scheduleIds.filter((x): x is string => Boolean(x)))].sort()
  const query = useLiveQuery({
    tables: ['bookings', 'booking_supplies'],
    queryKey: ['events', ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('bookings').select('*').in('schedule_id', ids).eq('status', 'accepted')
      if (error) throw error
      const bookings = data as Booking[]
      if (bookings.length === 0) return {} as Record<string, EventInfo>
      const { data: lines, error: linesError } = await supabase
        .from('booking_supplies')
        .select('booking_id, supply_id, quantity')
        .in(
          'booking_id',
          bookings.map((b) => b.id),
        )
      if (linesError) throw linesError
      const all = lines as BookingSupply[]
      return Object.fromEntries(bookings.map((b) => [b.schedule_id!, { booking: b, supplies: all.filter((l) => l.booking_id === b.id) }]))
    },
  })
  return query.data ?? {}
}

/** What a client sees on a business's public booking page. */
export type BookingPageInfo = {
  name: string
  phone: string | null
  timezone: string
  intro: string | null
  days: number[]
  open: string
  close: string
  first_day: string
  last_day: string
  capacity: number
  busy: { starts_at: string; ends_at: string }[]
}

export function useBookingPage(slug: string) {
  return useLiveQuery({
    tables: ['bookings', 'schedules'],
    queryKey: ['booking-page', slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('booking_page', { p_slug: slug })
      if (error) throw error
      return data as BookingPageInfo | null
    },
  })
}

/** "Sat, May 9, 12:00 PM to 3:00 PM" in the viewer's time. */
export function whenText(b: { starts_at: string; ends_at: string }) {
  const start = new Date(b.starts_at)
  const end = new Date(b.ends_at)
  const date = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${date}, ${time(start)} to ${time(end)}`
}

/** A Google Maps search link for an address. */
export const mapLink = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`
