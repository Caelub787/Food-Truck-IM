import { Check, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Badge, Button, Card, Notice, Spinner } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { usePeopleNames, useStockLevels } from '@/features/inventory/data'
import { useSettings } from '@/features/settings/useSettings'
import { BackLink } from '@/features/setup/BackLink'
import { useLocations, useSupplyCatalog, useTrucks } from '@/features/setup/data'
import { rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import type { ShiftCtx } from './context'
import { CountStep } from './CountStep'
import { CrewSheet } from './CrewSheet'
import {
  shiftStage,
  shiftSupplyIds,
  stageLabels,
  useShift,
  useShiftCounts,
  useShiftCrew,
  useShiftMoves,
  useShiftWaste,
  useTruckPars,
} from './data'
import { FinishStep } from './FinishStep'
import { LoadStep } from './LoadStep'
import { WasteStep } from './WasteStep'

type StepKey = 'start' | 'load' | 'waste' | 'end' | 'finish'

/** One shift, step by step: starting count, load, waste, ending count, finish. */
export function ShiftPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const me = useMeLoaded()
  const shift = useShift(id)
  const crew = useShiftCrew(id)
  const counts = useShiftCounts(id)
  const moves = useShiftMoves(id)
  const waste = useShiftWaste(id)
  const pars = useTruckPars()
  const levels = useStockLevels()
  const catalog = useSupplyCatalog()
  const trucks = useTrucks()
  const locations = useLocations()
  const settings = useSettings()
  const name = usePeopleNames()
  const [crewOpen, setCrewOpen] = useState(false)
  const cancel = useAction(async () => {
    await rpc('cancel_shift', { p_shift_id: id })
    navigate('/shifts')
  })

  const s = shift.data
  if (shift.isLoading || !catalog.data || !levels.data || !crew.data || !counts.data || !moves.data || !waste.data || !pars.data) {
    return <Spinner />
  }
  if (!s) {
    return (
      <div>
        <BackLink to="/shifts" label="Shifts" />
        <Notice tone="warning">This shift wasn't found. It may have been cancelled, or you're not on it.</Notice>
      </div>
    )
  }

  const role = me.profile?.role
  const levelAt = (placeId: string, supplyId: string) =>
    Number(levels.data.find((l) => l.place_id === placeId && l.supply_id === supplyId)?.quantity ?? 0)
  const ctx: ShiftCtx = {
    shift: s,
    truck: trucks.data?.find((t) => t.id === s.truck_id),
    locations: locations.data ?? [],
    catalog: catalog.data,
    settings: settings.data,
    levels: levels.data,
    counts: counts.data,
    moves: moves.data,
    pars: pars.data,
    waste: waste.data,
    crew: crew.data,
    me,
    canLead: s.lead_id === me.user_id || role === 'admin' || role === 'manager',
    leadName: name(s.lead_id) || 'The Lead',
    name,
    supplyIds: shiftSupplyIds({ truckId: s.truck_id, levels: levels.data, counts: counts.data, moves: moves.data, pars: pars.data }),
    onTruck: (supplyId) => levelAt(s.truck_id, supplyId),
    at: levelAt,
  }

  const stage = shiftStage(s)
  const loads = moves.data.filter((m) => m.kind === 'load').length
  const steps: { key: StepKey; label: string; done: boolean; note?: string }[] = [
    { key: 'start', label: 'Starting count', done: Boolean(s.start_confirmed_at) },
    { key: 'load', label: 'Load', done: loads > 0, note: loads > 0 ? `${loads} loaded` : undefined },
    { key: 'waste', label: 'Waste', done: false, note: waste.data.length > 0 ? `${waste.data.length} logged` : undefined },
    { key: 'end', label: 'Ending count', done: Boolean(s.end_confirmed_at) },
    { key: 'finish', label: s.status === 'closed' ? 'Results' : 'Finish', done: s.status === 'closed' },
  ]
  const defaultStep: StepKey = stage === 'start' ? 'start' : stage === 'working' ? 'load' : 'finish'
  const step = (params.get('step') as StepKey | null) ?? defaultStep
  const go = (key: StepKey) => setParams({ step: key }, { replace: true })
  const truckName = ctx.truck?.name ?? 'Truck'
  const crewNames = crew.data
    .filter((r) => r.role === 'crew')
    .map((r) => name(r.user_id))
    .filter(Boolean)

  return (
    <div>
      <BackLink to="/shifts" label="Shifts" />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{truckName}</h1>
            <Badge tone={stage === 'closed' ? 'green' : stage === 'cancelled' ? 'gray' : 'blue'}>{stageLabels[stage]}</Badge>
          </div>
          <p className="mt-1 text-slate-600">
            {new Date(`${s.business_date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
            {s.event_name && <> · {s.event_name}</>}
          </p>
          <p className="text-slate-600">
            Lead: <strong>{ctx.leadName}</strong>
            {crewNames.length > 0 && <> · Crew: {crewNames.join(', ')}</>}
          </p>
        </div>
        {s.status === 'open' && ctx.canLead && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCrewOpen(true)}>
              <Users className="size-5" aria-hidden /> Crew
            </Button>
            {stage === 'start' && (
              <ConfirmButton variant="ghost" busy={cancel.busy} confirmLabel="Tap again to cancel" onConfirm={() => void cancel.run()}>
                Cancel shift
              </ConfirmButton>
            )}
          </div>
        )}
      </div>
      {cancel.error && <Notice tone="error">{cancel.error}</Notice>}

      <div className="grid items-start gap-4 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Shift steps" className="-mx-4 overflow-x-auto px-4 lg:sticky lg:top-8 lg:mx-0 lg:px-0">
          <ol className="flex gap-2 lg:flex-col">
            {steps.map((st, i) => (
              <li key={st.key} className="shrink-0">
                <button
                  onClick={() => go(st.key)}
                  aria-current={step === st.key ? 'step' : undefined}
                  className={`flex min-h-12 w-full items-center gap-2.5 rounded-xl px-3 text-left font-medium lg:min-h-14 ${
                    step === st.key ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      st.done ? 'bg-emerald-500 text-white' : step === st.key ? 'bg-white/20' : 'bg-slate-100'
                    }`}
                  >
                    {st.done ? <Check className="size-4" aria-label="Done" /> : i + 1}
                  </span>
                  <span className="whitespace-nowrap">
                    {st.label}
                    {st.note && <span className={`hidden text-sm font-normal lg:block ${step === st.key ? 'text-white/80' : 'text-slate-500'}`}>{st.note}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section aria-label={steps.find((x) => x.key === step)?.label} className="min-w-0">
          {step === 'start' && <CountStep ctx={ctx} kind="start" key="start" onConfirmed={() => go('load')} />}
          {step === 'load' && <LoadStep ctx={ctx} />}
          {step === 'waste' && <WasteStep ctx={ctx} />}
          {step === 'end' && <CountStep ctx={ctx} kind="end" key="end" onConfirmed={() => go('finish')} />}
          {step === 'finish' && <FinishStep ctx={ctx} />}
          {stage === 'working' && step !== 'end' && (
            <Card className="mt-6">
              <p className="font-medium">Done for the day?</p>
              <p className="text-slate-600">Count what's left before anything goes back to the warehouse.</p>
              <Button variant="secondary" className="mt-3" onClick={() => go('end')}>
                Start the ending count
              </Button>
            </Card>
          )}
        </section>
      </div>

      {s.status === 'open' && <CrewSheet open={crewOpen} onClose={() => setCrewOpen(false)} shiftId={s.id} leadId={s.lead_id} crew={crew.data} />}
    </div>
  )
}
