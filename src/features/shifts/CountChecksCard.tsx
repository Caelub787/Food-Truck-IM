import { ClipboardCheck } from 'lucide-react'
import { Link } from 'react-router'
import { Card } from '@/components/ui'
import { useSettings } from '@/features/settings/useSettings'
import { useTrucks } from '@/features/setup/data'
import { useShifts } from './data'

/** Finished shifts waiting for a manager to recount (when the business uses count checks). */
export function CountChecksCard() {
  const settings = useSettings()
  const shifts = useShifts({ limit: 60 })
  const trucks = useTrucks()
  if (!settings.data?.count_checks_enabled) return null
  const waiting = (shifts.data ?? []).filter((s) => s.count_check_status === 'waiting')
  if (waiting.length === 0) return null
  return (
    <Card>
      <div className="flex items-center gap-2">
        <ClipboardCheck className="size-5 text-brand-700" aria-hidden />
        <h2 className="font-semibold">Count checks waiting</h2>
      </div>
      <p className="mt-1 text-slate-600">Count these before the truck goes out again.</p>
      <ul className="mt-2 divide-y divide-slate-100">
        {waiting.map((s) => (
          <li key={s.id}>
            <Link to={`/shifts/${s.id}?step=check`} className="flex min-h-12 items-center justify-between gap-3 py-2 font-medium text-brand-700">
              <span>{trucks.data?.find((t) => t.id === s.truck_id)?.name ?? 'Truck'}</span>
              <span className="text-sm font-normal text-slate-500">
                finished {s.ended_at ? new Date(s.ended_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
