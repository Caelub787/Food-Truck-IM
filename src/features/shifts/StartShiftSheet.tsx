import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button, Field, Notice, Select, Sheet } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { newClientId } from '@/features/inventory/data'
import { usePeople } from '@/features/people/people'
import { useTrucks } from '@/features/setup/data'
import { isNetworkError } from '@/lib/offline'
import { rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { CrewPicker } from './CrewPicker'
import { useOpenShifts, workers } from './data'

/** Starting a shift: pick the truck, the Lead, and the crew. */
export function StartShiftSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMeLoaded()
  const navigate = useNavigate()
  const trucks = useTrucks()
  const people = usePeople()
  const openShifts = useOpenShifts()
  const [truckId, setTruckId] = useState('')
  const [lead, setLead] = useState(me.user_id)
  const [crew, setCrew] = useState<string[]>([])
  const [eventName, setEventName] = useState('')
  const busyTrucks = new Set((openShifts.data ?? []).map((o) => o.truck_id))
  const active = (trucks.data ?? []).filter((t) => t.active)
  const truck = truckId || active.find((t) => !busyTrucks.has(t.id))?.id || ''

  const start = useAction(async () => {
    if (!truck) throw new Error('Pick a truck.')
    if (!lead) throw new Error('Pick a Lead.')
    try {
      const id = await rpc<string>('start_shift', {
        p: { truck_id: truck, lead_id: lead, crew_ids: crew.filter((c) => c !== lead), event_name: eventName, client_id: newClientId() },
      })
      onClose()
      navigate(`/shifts/${id}`)
    } catch (e) {
      if (isNetworkError(e)) throw new Error('Starting a shift needs signal. Try again in a spot with a better connection.', { cause: e })
      throw e
    }
  })

  return (
    <Sheet title="Start a shift" open={open} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void start.run()
        }}
      >
        <Select label="Truck" value={truck} onChange={(e) => setTruckId(e.target.value)}>
          <option value="">Pick a truck</option>
          {active.map((t) => (
            <option key={t.id} value={t.id} disabled={busyTrucks.has(t.id)}>
              {t.name}
              {busyTrucks.has(t.id) ? ' (shift going, join it instead)' : ''}
            </option>
          ))}
        </Select>
        <CrewPicker people={workers(people.data)} lead={lead} onLead={setLead} crew={crew} onCrew={setCrew} />
        <Field label="Event or spot (optional)" value={eventName} onChange={(e) => setEventName(e.target.value)} maxLength={120} />
        {start.error && <Notice tone="error">{start.error}</Notice>}
        <Button type="submit" busy={start.busy} full>
          Start shift
        </Button>
      </form>
    </Sheet>
  )
}
