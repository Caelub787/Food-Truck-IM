import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, Notice, Sheet } from '@/components/ui'
import { usePeople } from '@/features/people/people'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { CrewPicker } from './CrewPicker'
import { workers, type CrewRow } from './data'

/** Change who's on a shift and who leads it. */
export function CrewSheet({
  open,
  onClose,
  shiftId,
  leadId,
  crew,
}: {
  open: boolean
  onClose: () => void
  shiftId: string
  leadId: string
  crew: CrewRow[]
}) {
  const people = usePeople()
  const queryClient = useQueryClient()
  const [lead, setLead] = useState(leadId)
  const [members, setMembers] = useState(crew.filter((c) => c.role === 'crew').map((c) => c.user_id))
  const save = useAction(async () => {
    if (!lead) throw new Error('Pick a Lead.')
    await rpc('set_shift_crew', { p_shift_id: shiftId, p_lead_id: lead, p_crew_ids: members.filter((m) => m !== lead) })
    await refreshTables(queryClient, ['shifts', 'shift_crew'])
    onClose()
  })

  return (
    <Sheet title="Who's working" open={open} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <CrewPicker people={workers(people.data)} lead={lead} onLead={setLead} crew={members} onCrew={setMembers} />
        {save.error && <Notice tone="error">{save.error}</Notice>}
        <Button busy={save.busy} onClick={() => void save.run()} full>
          Save
        </Button>
      </div>
    </Sheet>
  )
}
