import { Plus } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/forms'
import { Button, Notice } from '@/components/ui'
import { WasteList } from '@/features/waste/WasteList'
import { WasteSheet } from '@/features/waste/WasteSheet'
import type { ShiftCtx } from './context'

/** Waste on this shift: anyone on it can log some while the shift is going. */
export function WasteStep({ ctx }: { ctx: ShiftCtx }) {
  const { shift } = ctx
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const canLog = shift.status === 'open' && Boolean(shift.start_confirmed_at) && !shift.end_confirmed_at
  const isManager = ctx.me.profile?.role !== 'driver'

  return (
    <div className="space-y-4">
      {!shift.start_confirmed_at && <Notice>Confirm the starting count first. Then you can log waste here.</Notice>}
      {shift.end_confirmed_at && shift.status === 'open' && (
        <Notice>The ending count is done, so the waste list is closed for this shift.</Notice>
      )}
      {done && <Notice tone="success">{done}</Notice>}
      {canLog && (
        <Button onClick={() => setOpen(true)} full className="md:w-auto">
          <Plus className="size-5" aria-hidden /> Log waste
        </Button>
      )}
      {ctx.waste.length === 0 ? (
        <EmptyState title="No waste on this shift">Spills, drops, and anything thrown out go here.</EmptyState>
      ) : (
        <WasteList rows={[...ctx.waste].reverse()} showCost={isManager} />
      )}
      {ctx.me.company && (
        <WasteSheet
          open={open}
          onClose={() => setOpen(false)}
          onSaved={setDone}
          companyId={ctx.me.company.id}
          shift={shift}
          truckTypeId={ctx.truck?.truck_type_id}
        />
      )}
    </div>
  )
}
