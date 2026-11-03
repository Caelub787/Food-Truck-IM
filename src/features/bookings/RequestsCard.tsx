import { CalendarCheck } from 'lucide-react'
import { Link } from 'react-router'
import { Card } from '@/components/ui'
import { useSettings } from '@/features/settings/useSettings'
import { useBookings, whenText } from './data'

/** On a manager's home screen: booking requests waiting for an answer. */
export function RequestsCard() {
  const settings = useSettings()
  const bookings = useBookings()
  const waiting = (bookings.data?.bookings ?? []).filter((b) => b.status === 'pending').sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  if (!settings.data?.bookings_enabled || waiting.length === 0) return null
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <CalendarCheck className="size-5 text-brand-700" aria-hidden />
          {waiting.length === 1 ? '1 booking request waiting' : `${waiting.length} booking requests waiting`}
        </h2>
        <Link to="/bookings" className="text-sm font-medium text-brand-700">
          See all
        </Link>
      </div>
      <ul className="mt-3 divide-y divide-slate-100">
        {waiting.slice(0, 3).map((b) => (
          <li key={b.id}>
            <Link to={`/bookings?open=${b.id}`} className="flex min-h-14 flex-col justify-center py-2 hover:text-brand-700">
              <span className="font-medium">{b.event_name || b.organization || b.client_name}</span>
              <span className="text-sm text-slate-500">{whenText(b)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
