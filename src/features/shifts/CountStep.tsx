import { useState } from 'react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Badge, Notice } from '@/components/ui'
import { friendlyError } from '@/lib/errors'
import { sendOrQueue } from '@/lib/offline'
import { findUnit, formatAmount } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import type { ShiftCtx } from './context'
import { sortSupplies } from './data'
import { SaveState } from './SaveState'
import { ActionBar, SupplyCards } from './SupplyCards'
import { useCountDraft } from './useCountDraft'

const SHIFT_TABLES = ['shifts', 'shift_counts', 'stock_levels', 'stock_movements', 'flags']

/**
 * Counting the truck. At the start, lines are filled in with what the app
 * expects, and people change what's different. At the end, everything is
 * counted from scratch. Anyone on the shift can count. The Lead confirms.
 */
export function CountStep({ ctx, kind, onConfirmed }: { ctx: ShiftCtx; kind: 'start' | 'end'; onConfirmed: () => void }) {
  const { shift, catalog: c } = ctx
  const draft = useCountDraft(shift.id, kind, ctx.counts)
  const [added, setAdded] = useState<string[]>([])
  const confirmed = kind === 'start' ? Boolean(shift.start_confirmed_at) : Boolean(shift.end_confirmed_at)
  const locked = confirmed || shift.status !== 'open' || (kind === 'end' && !shift.start_confirmed_at)

  const ids = new Set([...ctx.supplyIds, ...added])
  const supplies = sortSupplies(c, ids)
  const addable = c.supplies
    .filter((s) => s.active && !ids.has(s.id))
    .filter((s) => !s.truck_type_id || s.truck_type_id === ctx.truck?.truck_type_id)
    .sort((a, b) => a.name.localeCompare(b.name))

  const confirm = useAction(async () => {
    await draft.flush()
    if (kind === 'end') {
      const missing = supplies.filter((s) => draft.value(s.id) === undefined)
      if (missing.length > 0) throw new Error(`Count everything that's left first. Still need: ${missing.map((s) => s.name).join(', ')}.`)
    }
    const result = await sendOrQueue({
      fn: kind === 'start' ? 'confirm_shift_start' : 'confirm_shift_end',
      args: { p_shift_id: shift.id },
      tables: SHIFT_TABLES,
      label: kind === 'start' ? 'Confirm starting count' : 'Confirm ending count',
    }).catch((e: unknown) => {
      throw new Error(friendlyError(e))
    })
    if (result === 'queued') throw new Error("No signal right now. It'll confirm as soon as the phone is back online.")
    onConfirmed()
  })

  if (kind === 'end' && !shift.start_confirmed_at) {
    return <Notice>Confirm the starting count first.</Notice>
  }

  // What the app had on the truck: saved when the count was confirmed, live before that.
  const startExpected = (id: string) => {
    const saved = ctx.counts.find((x) => x.supply_id === id && x.kind === 'start')
    return confirmed && saved?.expected != null ? Number(saved.expected) : ctx.onTruck(id)
  }
  const counted = supplies.filter((s) => draft.value(s.id) !== undefined).length
  const changed = supplies.filter((s) => {
    const v = draft.value(s.id)
    return v !== undefined && v !== null && Math.abs(v - ctx.onTruck(s.id)) > 0.0001
  })

  return (
    <div>
      {kind === 'start' && !confirmed && (
        <Notice>
          Check what's on the truck. Each line shows what the app thinks is there. Only change the ones that are different. When it all looks
          right, the Lead confirms.
        </Notice>
      )}
      {kind === 'end' && !confirmed && (
        <Notice>
          Count everything left on the truck before anything goes back to the warehouse. Everyone on the shift can help. When it's all
          counted, the Lead confirms.
        </Notice>
      )}
      {confirmed && (
        <Notice tone="success">
          {kind === 'start' ? 'Starting count confirmed.' : 'Ending count confirmed.'} These numbers are locked in.
        </Notice>
      )}

      <div className="mt-4">
        <SupplyCards
          catalog={c}
          supplies={supplies}
          disabled={locked}
          value={(id) => {
            const v = draft.value(id)
            if (v !== undefined) return v
            return kind === 'start' ? Math.max(0, ctx.onTruck(id)) : null
          }}
          onChange={draft.set}
          info={(s) => {
            const unit = findUnit(c.unitsOf(s.id), s.count_unit_id)
            const v = draft.value(s.id)
            if (kind === 'start') {
              if (!confirmed) return `App has ${formatAmount(ctx.onTruck(s.id), unit)}`
              return `Counted ${formatAmount(v ?? 0, unit)}, app had ${formatAmount(startExpected(s.id), unit)}`
            }
            return v === undefined ? 'Not counted yet' : `Counted ${formatAmount(v ?? 0, unit)}`
          }}
          badge={(s) => {
            const v = draft.value(s.id)
            if (kind === 'end') return v === undefined ? <Badge tone="amber">To count</Badge> : <Badge tone="green">Counted</Badge>
            if (v === undefined) return confirmed ? null : <Badge>As expected</Badge>
            return Math.abs((v ?? 0) - startExpected(s.id)) > 0.0001 ? <Badge tone="amber">Different</Badge> : <Badge tone="green">Checked</Badge>
          }}
          highlight={(s) => kind === 'end' && draft.value(s.id) === undefined && !locked}
          addable={addable}
          onAdd={(id) => {
            setAdded([...added, id])
            if (kind === 'end') draft.set(id, 0)
          }}
        />
      </div>

      {!locked && (
        <ActionBar>
          <div className="flex flex-col">
            <span className="text-slate-600">
              {kind === 'start'
                ? changed.length === 0
                  ? 'Everything matches so far'
                  : `${changed.length} different from the app`
                : `${counted} of ${supplies.length} counted`}
            </span>
            <SaveState status={draft.status} error={draft.error} />
          </div>
          {confirm.error && <Notice tone="error">{confirm.error}</Notice>}
          {ctx.canLead ? (
            <ConfirmButton
              busy={confirm.busy}
              disabled={kind === 'end' && counted < supplies.length}
              confirmLabel="Tap again to confirm"
              onConfirm={() => void confirm.run()}
            >
              {kind === 'start' ? 'Confirm starting count' : 'Confirm ending count'}
            </ConfirmButton>
          ) : (
            <span className="text-sm text-slate-500">{ctx.leadName} (the Lead) confirms when it's done.</span>
          )}
        </ActionBar>
      )}
    </div>
  )
}
