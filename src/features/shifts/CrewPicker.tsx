import { Select } from '@/components/ui'
import type { Person } from '@/features/people/people'

/** Pick the Lead and anyone else working the shift. */
export function CrewPicker({
  people,
  lead,
  onLead,
  crew,
  onCrew,
}: {
  people: Person[]
  lead: string
  onLead: (id: string) => void
  crew: string[]
  onCrew: (ids: string[]) => void
}) {
  const others = people.filter((p) => p.user_id !== lead)
  return (
    <>
      <Select label="Lead" hint="The Lead confirms counts and finishes the shift." value={lead} onChange={(e) => onLead(e.target.value)}>
        <option value="">Pick someone</option>
        {people.map((p) => (
          <option key={p.user_id} value={p.user_id}>
            {p.full_name}
          </option>
        ))}
      </Select>
      {others.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Crew (anyone else working)</p>
          <div className="flex flex-wrap gap-2">
            {others.map((p) => {
              const on = crew.includes(p.user_id)
              return (
                <button
                  key={p.user_id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onCrew(on ? crew.filter((x) => x !== p.user_id) : [...crew, p.user_id])}
                  className={`min-h-11 rounded-full px-4 font-medium ${on ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-slate-200 hover:bg-slate-50'}`}
                >
                  {p.full_name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
