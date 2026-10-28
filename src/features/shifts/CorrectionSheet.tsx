import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { CountInput } from '@/components/CountInput'
import { Segmented } from '@/components/forms'
import { Button, Field, Notice, Sheet } from '@/components/ui'
import type { Catalog } from '@/features/setup/data'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { findUnit, formatAmount } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import type { ShiftResult } from './data'

/** A manager fixes a count on a finished shift. The reason goes in the history. */
export function CorrectionSheet({ shiftId, result, catalog: c, onClose }: { shiftId: string; result: ShiftResult; catalog: Catalog; onClose: () => void }) {
  const queryClient = useQueryClient()
  const supply = c.supply(result.supply_id)!
  const unit = findUnit(c.unitsOf(supply.id), supply.count_unit_id)
  const [kind, setKind] = useState<'end' | 'start'>('end')
  const current = Number(kind === 'end' ? result.end_qty : result.start_qty)
  const [amount, setAmount] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const save = useAction(async () => {
    if (amount === null) throw new Error('Enter the right amount.')
    await rpc('correct_shift_count', { p: { shift_id: shiftId, supply_id: supply.id, kind, quantity: amount * unit.factor, reason } })
    await refreshTables(queryClient, ['shift_counts', 'shift_results', 'stock_levels', 'stock_movements', 'flags', 'audit_log'])
    onClose()
  })

  return (
    <Sheet title={`Fix ${supply.name}`} open onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save.run()
        }}
      >
        <Segmented
          label="Which count"
          value={kind}
          onChange={(v) => {
            setKind(v)
            setAmount(null)
          }}
          options={[
            { value: 'end', label: 'Ending count' },
            { value: 'start', label: 'Starting count' },
          ]}
        />
        <p className="text-slate-600">Right now it says {formatAmount(current, unit)}.</p>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">The right amount</p>
          <CountInput label={`Right ${kind === 'end' ? 'ending' : 'starting'} count`} unit={unit.name} wholeOnly={supply.whole_only} value={amount} onChange={setAmount} />
        </div>
        <Field label="Why" required placeholder="Like: recounted, missed a box under the seat" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        <p className="text-sm text-slate-500">The shift's results are worked out again. If the truck hasn't gone out since, its stock is fixed too.</p>
        {save.error && <Notice tone="error">{save.error}</Notice>}
        <Button type="submit" busy={save.busy} full>
          Save the fix
        </Button>
      </form>
    </Sheet>
  )
}
