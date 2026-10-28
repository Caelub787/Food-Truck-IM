import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Card } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { useSettings } from '@/features/settings/useSettings'
import { useTrucks } from '@/features/setup/data'
import { addDays, timeText, usePlans } from './data'

/** Drivers: their next planned shifts. Managers: what's planned today. */
export function UpcomingCard() {
  const me = useMeLoaded()
  const settings = useSettings()
  const trucks = useTrucks()
  const [now] = useState(() => Date.now())
  const from = new Date(now - 12 * 3600_000)
  const plans = usePlans(from, addDays(new Date(now), 8))
  if (!settings.data?.scheduling_enabled || !plans.data) return null
  const isManager = me.profile?.role !== 'driver'
  const today = new Date(now).toDateString()
  const list = plans.data
    .filter((p) => p.status === 'planned' && Date.parse(p.ends_at) > now)
    .filter((p) => (isManager ? new Date(p.starts_at).toDateString() === today : p.lead_id === me.user_id || p.crew.includes(me.user_id)))
    .slice(0, 5)

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-5 text-brand-700" aria-hidden />
          <h2 className="font-semibold">{isManager ? 'Planned today' : 'Your next shifts'}</h2>
        </div>
        <Link to="/schedule" className="text-sm font-medium text-brand-700">
          Schedule
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="mt-1 text-slate-600">{isManager ? 'Nothing planned today.' : 'Nothing planned for you this week.'}</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {list.map((p) => (
            <li key={p.id} className="py-2">
              <p className="font-medium">
                {new Date(p.starts_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, {timeText(p.starts_at)} to{' '}
                {timeText(p.ends_at)}
              </p>
              <p className="text-sm text-slate-600">
                {trucks.data?.find((t) => t.id === p.truck_id)?.name ?? 'Truck'}
                {p.event_name && ` · ${p.event_name}`}
                {p.lead_id === me.user_id && ' · you lead'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
