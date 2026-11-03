import { MapPin, Phone, Users } from 'lucide-react'
import type { Catalog } from '@/features/setup/data'
import { findUnit, formatAmount } from '@/lib/units'
import { mapLink, type EventInfo } from './data'

/**
 * What the crew needs for a booked event: where it is, who to call on site,
 * the manager in charge, notes, and what to bring. Addresses open in maps and
 * phone numbers can be tapped to call.
 */
export function EventDetails({
  event,
  catalog,
  name,
  phone,
}: {
  event: EventInfo
  catalog: Catalog | undefined
  name: (userId: string | null) => string
  phone?: (userId: string | null) => string | null
}) {
  const b = event.booking
  const managerPhone = phone?.(b.manager_id)
  const lines = event.supplies
    .map((l) => {
      const s = catalog?.supply(l.supply_id)
      if (!s) return null
      return { id: l.supply_id, name: s.name, amount: formatAmount(Number(l.quantity), findUnit(catalog!.unitsOf(s.id), s.count_unit_id)) }
    })
    .filter((x) => x !== null)
    .sort((a, b2) => a.name.localeCompare(b2.name))

  return (
    <div className="flex flex-col gap-3 text-sm">
      <a href={mapLink(b.place)} target="_blank" rel="noreferrer" className="flex min-h-11 items-start gap-2 font-medium text-brand-700 hover:underline">
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{b.place}</span>
      </a>
      {(b.contact_name || b.contact_phone) && (
        <div className="flex items-start gap-2">
          <Phone className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
          <span>
            On site: {b.contact_name}
            {b.contact_phone && (
              <>
                {b.contact_name ? ', ' : ''}
                <a href={`tel:${b.contact_phone}`} className="font-medium text-brand-700 hover:underline">
                  {b.contact_phone}
                </a>
              </>
            )}
          </span>
        </div>
      )}
      {b.manager_id && (
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
          <span>
            Manager: {name(b.manager_id)}
            {managerPhone && (
              <>
                ,{' '}
                <a href={`tel:${managerPhone}`} className="font-medium text-brand-700 hover:underline">
                  {managerPhone}
                </a>
              </>
            )}
          </span>
        </div>
      )}
      {b.guests !== null && <p className="text-slate-600">About {b.guests} people</p>}
      {b.crew_notes && <p className="whitespace-pre-line text-slate-600">{b.crew_notes}</p>}
      {lines.length > 0 && (
        <div>
          <p className="font-semibold text-slate-700">Bring for this event</p>
          <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
            {lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 border-b border-slate-100 py-1.5">
                <span>{l.name}</span>
                <span className="font-medium">{l.amount}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
