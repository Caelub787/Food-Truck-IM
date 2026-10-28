import { Download } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { EmptyState, Segmented } from '@/components/forms'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Button, Card, PageHeader, Select, Spinner } from '@/components/ui'
import { usePeopleNames } from '@/features/inventory/data'
import { groupLabels } from '@/features/sales/data'
import { useSupplyCatalog, useTrucks, type Catalog, type Named } from '@/features/setup/data'
import { downloadCsv } from '@/lib/csv'
import { useRows } from '@/lib/data'
import { findUnit, formatAmount, formatMoney, type Unit } from '@/lib/units'
import { periodRange, periods, useReport, type Period, type Report } from './data'

type Tab = 'overview' | 'usage' | 'waste' | 'free' | 'drivers' | 'checks' | 'shifts'
const tabs: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'usage', label: 'Usage vs sales' },
  { value: 'waste', label: 'Waste' },
  { value: 'free', label: 'Free drinks' },
  { value: 'drivers', label: 'Drivers' },
  { value: 'checks', label: 'Count checks' },
  { value: 'shifts', label: 'Shifts' },
]

/** Reports read from finished shifts, so they never change when recipes do. */
export function ReportsPage() {
  const [period, setPeriod] = useState<Period>('month30')
  const [truckId, setTruckId] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [now] = useState(() => new Date())
  const [from, to] = periodRange(period, now)
  const report = useReport(from, to, truckId)
  const trucks = useTrucks()
  const catalog = useSupplyCatalog()
  const r = report.data
  const t = r?.totals
  const label = `${periods[period].toLowerCase()}${truckId ? `, ${trucks.data?.find((x) => x.id === truckId)?.name}` : ''}`

  return (
    <div>
      <PageHeader title="Reports" subtitle="Usage, waste, free drinks, drivers, and sales minus costs, from finished shifts." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Select label="When" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          {Object.entries(periods).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select label="Truck" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
          <option value="">All trucks</option>
          {(trucks.data ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </div>

      {!r || !t || !catalog.data ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Shifts" value={String(t.shifts)} />
            <Tile label="Drinks (free)" value={`${t.drinks} (${t.free})`} />
            <Tile label="Sales" value={formatMoney(t.revenue)} />
            <Tile label="Supplies used" value={formatMoney(t.used)} />
            <Tile label="Waste" value={formatMoney(t.all_waste)} />
            <Tile
              label="Sales minus costs"
              value={formatMoney(t.revenue - t.used - t.all_waste)}
              note={t.revenue === 0 ? 'No sales entered' : undefined}
            />
          </div>
          <div className="-mx-4 mb-4 overflow-x-auto px-4 pb-1">
            <div className="w-max">
              <Segmented label="Report" value={tab} onChange={setTab} options={tabs} />
            </div>
          </div>
          {t.shifts === 0 && tab !== 'waste' ? (
            <EmptyState title="No finished shifts in this time">Pick a longer time, or finish a shift first.</EmptyState>
          ) : (
            <Section tab={tab} report={r} catalog={catalog.data} label={label} />
          )}
        </>
      )}
    </div>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
      {note && <p className="text-xs text-slate-400">{note}</p>}
    </Card>
  )
}

function CsvButton({ name, rows }: { name: string; rows: unknown[][] }) {
  return (
    <Button variant="secondary" onClick={() => downloadCsv(name, rows)} disabled={rows.length <= 1}>
      <Download className="size-5" aria-hidden /> CSV
    </Button>
  )
}

function SectionHead({ title, children, csv }: { title: string; children?: ReactNode; csv: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {children && <p className="text-slate-600">{children}</p>}
      </div>
      {csv}
    </div>
  )
}

function Section({ tab, report: r, catalog: c, label }: { tab: Tab; report: Report; catalog: Catalog; label: string }) {
  const navigate = useNavigate()
  const trucks = useTrucks()
  const who = usePeopleNames()
  const wasteReasons = useRows<Named>('waste_reasons', { order: 'sort,name' })
  const freeReasons = useRows<Named>('free_reasons', { order: 'sort,name' })
  const truckName = (id: string) => trucks.data?.find((x) => x.id === id)?.name ?? 'Truck'
  const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const unitFor = (supplyId: string | null, groupId: string | null): Unit => {
    if (supplyId) {
      const s = c.supply(supplyId)
      return s ? findUnit(c.unitsOf(s.id), s.count_unit_id) : { id: null, name: '', factor: 1 }
    }
    return { id: null, name: c.group(groupId)?.base_unit ?? '', factor: 1 }
  }
  const nameFor = (supplyId: string | null, groupId: string | null) =>
    supplyId ? (c.supply(supplyId)?.name ?? 'Supply') : `${c.group(groupId)?.name ?? 'Group'} (all together)`

  if (tab === 'overview') {
    const byTruck = new Map<string, { shifts: number; drinks: number; revenue: number; used: number; waste: number }>()
    for (const s of r.shifts) {
      const x = byTruck.get(s.truck_id) ?? { shifts: 0, drinks: 0, revenue: 0, used: 0, waste: 0 }
      x.shifts++
      x.drinks += Number(s.drinks)
      x.revenue += Number(s.revenue)
      x.used += Number(s.used)
      x.waste += Number(s.waste)
      byTruck.set(s.truck_id, x)
    }
    const trucksRows = [...byTruck.entries()].map(([id, x]) => ({ id, ...x }))
    return (
      <div className="space-y-6">
        <div>
          <SectionHead
            title="By day"
            csv={
              <CsvButton
                name="report-by-day.csv"
                rows={[['Day', 'Shifts', 'Drinks', 'Sales', 'Supplies used', 'Waste'], ...r.days.map((d) => [d.date, d.shifts, d.drinks, d.revenue, d.used, d.waste])]}
              />
            }
          >
            {label}
          </SectionHead>
          <ResponsiveList
            rows={[...r.days].reverse()}
            rowKey={(d) => d.date}
            title={(d) => dayLabel(d.date)}
            subtitle={(d) => `${d.shifts} shifts · ${d.drinks} drinks · ${formatMoney(d.used)} used · ${formatMoney(d.waste)} waste`}
            badge={(d) => <span className="font-semibold tabular-nums">{formatMoney(d.revenue)}</span>}
            columns={[
              { label: 'Day', cell: (d) => dayLabel(d.date), className: 'whitespace-nowrap' },
              { label: 'Shifts', cell: (d) => d.shifts },
              { label: 'Drinks', cell: (d) => d.drinks },
              { label: 'Sales', cell: (d) => formatMoney(d.revenue) },
              { label: 'Supplies used', cell: (d) => formatMoney(d.used) },
              { label: 'Waste', cell: (d) => formatMoney(d.waste) },
              { label: 'Sales minus costs', cell: (d) => <span className="font-semibold">{formatMoney(d.revenue - d.used - d.waste)}</span> },
            ]}
          />
        </div>
        <div>
          <SectionHead
            title="By truck"
            csv={
              <CsvButton
                name="report-by-truck.csv"
                rows={[['Truck', 'Shifts', 'Drinks', 'Sales', 'Supplies used', 'Waste'], ...trucksRows.map((x) => [truckName(x.id), x.shifts, x.drinks, x.revenue, x.used, x.waste])]}
              />
            }
          />
          <ResponsiveList
            rows={trucksRows}
            rowKey={(x) => x.id}
            title={(x) => truckName(x.id)}
            subtitle={(x) => `${x.shifts} shifts · ${x.drinks} drinks · ${formatMoney(x.used)} used`}
            badge={(x) => <span className="font-semibold tabular-nums">{formatMoney(x.revenue - x.used - x.waste)}</span>}
            columns={[
              { label: 'Truck', cell: (x) => <span className="font-medium">{truckName(x.id)}</span> },
              { label: 'Shifts', cell: (x) => x.shifts },
              { label: 'Drinks', cell: (x) => x.drinks },
              { label: 'Sales', cell: (x) => formatMoney(x.revenue) },
              { label: 'Supplies used', cell: (x) => formatMoney(x.used) },
              { label: 'Waste', cell: (x) => formatMoney(x.waste) },
              { label: 'Sales minus costs', cell: (x) => <span className="font-semibold">{formatMoney(x.revenue - x.used - x.waste)}</span> },
            ]}
          />
        </div>
      </div>
    )
  }

  if (tab === 'usage') {
    const rows = [...r.supplies].sort((a, b) => Math.abs(Number(b.diff ?? 0)) - Math.abs(Number(a.diff ?? 0)) || nameFor(a.supply_id, a.group_id).localeCompare(nameFor(b.supply_id, b.group_id)))
    const amt = (x: (typeof rows)[number], n: number | null) => (n === null ? '' : formatAmount(Number(n), unitFor(x.supply_id, x.group_id)))
    const pct = (x: (typeof rows)[number]) => (x.expected && x.diff !== null ? `${Math.round((Number(x.diff) / Number(x.expected)) * 100)}%` : '')
    return (
      <div>
        <SectionHead
          title="Usage vs sales"
          csv={
            <CsvButton
              name="usage-vs-sales.csv"
              rows={[
                ['Supply', 'Used', 'Sales say', 'Difference', 'Difference %', 'Cost used', 'Shifts'],
                ...rows.map((x) => [nameFor(x.supply_id, x.group_id), x.actual, x.expected ?? '', x.diff ?? '', pct(x), x.cost ?? '', x.shifts]),
              ]}
            />
          }
        >
          What was used next to what the drinks sold should have used. A plus means more was used than sales explain.
        </SectionHead>
        <ResponsiveList
          rows={rows}
          rowKey={(x) => `${x.supply_id ?? ''}${x.group_id ?? ''}`}
          title={(x) => `${nameFor(x.supply_id, x.group_id)}: used ${amt(x, x.actual)}`}
          subtitle={(x) => (x.expected === null ? 'Not compared (no recipe uses it, or no sales)' : `Sales say ${amt(x, x.expected)} · ${pct(x)}`)}
          badge={(x) =>
            x.diff === null ? null : (
              <Badge tone={Math.abs(Number(x.diff)) > 0.1 * Number(x.expected || 1) ? 'amber' : 'green'}>
                {Number(x.diff) > 0 ? '+' : ''}
                {amt(x, x.diff)}
              </Badge>
            )
          }
          columns={[
            { label: 'Supply', cell: (x) => <span className={x.group_id ? 'italic' : 'font-medium'}>{nameFor(x.supply_id, x.group_id)}</span>, className: 'min-w-44' },
            { label: 'Used', cell: (x) => amt(x, x.actual), className: 'whitespace-nowrap' },
            { label: 'Sales say', cell: (x) => amt(x, x.expected), className: 'whitespace-nowrap' },
            { label: 'Difference', cell: (x) => (x.diff === null ? '' : `${Number(x.diff) > 0 ? '+' : ''}${amt(x, x.diff)}`), className: 'whitespace-nowrap' },
            { label: '%', cell: pct },
            { label: 'Cost used', cell: (x) => (x.cost === null ? '' : formatMoney(Number(x.cost))) },
          ]}
        />
      </div>
    )
  }

  if (tab === 'waste') {
    const reasonName = (id: string | null) => wasteReasons.data?.find((x) => x.id === id)?.name ?? 'No reason'
    return (
      <div className="space-y-6">
        <div>
          <SectionHead
            title="Waste by reason"
            csv={<CsvButton name="waste-by-reason.csv" rows={[['Reason', 'Times', 'Cost'], ...r.waste_reasons.map((x) => [reasonName(x.reason_id), x.count, x.cost])]} />}
          >
            Trucks and warehouse, {label}.
          </SectionHead>
          {r.waste_reasons.length === 0 ? (
            <EmptyState title="No waste in this time" />
          ) : (
            <ResponsiveList
              rows={r.waste_reasons}
              rowKey={(x) => x.reason_id ?? 'none'}
              title={(x) => reasonName(x.reason_id)}
              subtitle={(x) => `${x.count} time${x.count === 1 ? '' : 's'}`}
              badge={(x) => <span className="font-semibold tabular-nums">{formatMoney(x.cost)}</span>}
              columns={[
                { label: 'Reason', cell: (x) => <span className="font-medium">{reasonName(x.reason_id)}</span> },
                { label: 'Times', cell: (x) => x.count },
                { label: 'Cost', cell: (x) => formatMoney(x.cost) },
              ]}
            />
          )}
        </div>
        {r.waste_supplies.length > 0 && (
          <div>
            <SectionHead
              title="Waste by supply"
              csv={
                <CsvButton
                  name="waste-by-supply.csv"
                  rows={[['Supply', 'Amount', 'Cost'], ...r.waste_supplies.map((x) => [nameFor(x.supply_id, null), formatAmount(Number(x.quantity), unitFor(x.supply_id, null)), x.cost])]}
                />
              }
            />
            <ResponsiveList
              rows={r.waste_supplies}
              rowKey={(x) => x.supply_id}
              title={(x) => nameFor(x.supply_id, null)}
              subtitle={(x) => formatAmount(Number(x.quantity), unitFor(x.supply_id, null))}
              badge={(x) => <span className="font-semibold tabular-nums">{formatMoney(x.cost)}</span>}
              columns={[
                { label: 'Supply', cell: (x) => <span className="font-medium">{nameFor(x.supply_id, null)}</span> },
                { label: 'Amount', cell: (x) => formatAmount(Number(x.quantity), unitFor(x.supply_id, null)) },
                { label: 'Cost', cell: (x) => formatMoney(x.cost) },
              ]}
            />
          </div>
        )}
      </div>
    )
  }

  if (tab === 'free') {
    const reasonName = (id: string | null) => freeReasons.data?.find((x) => x.id === id)?.name ?? 'No reason'
    return (
      <div>
        <SectionHead
          title="Free drinks"
          csv={<CsvButton name="free-drinks.csv" rows={[['Reason', 'Drinks', 'Cost of supplies'], ...r.free_reasons.map((x) => [reasonName(x.reason_id), x.drinks, x.cost])]} />}
        >
          Drop replacements, giveaways, and employee drinks. They bring in nothing, but use supplies.
        </SectionHead>
        {r.free_reasons.length === 0 ? (
          <EmptyState title="No free drinks in this time" />
        ) : (
          <ResponsiveList
            rows={r.free_reasons}
            rowKey={(x) => x.reason_id ?? 'none'}
            title={(x) => reasonName(x.reason_id)}
            subtitle={(x) => `${x.drinks} drinks`}
            badge={(x) => <span className="font-semibold tabular-nums">{formatMoney(x.cost)}</span>}
            columns={[
              { label: 'Reason', cell: (x) => <span className="font-medium">{reasonName(x.reason_id)}</span> },
              { label: 'Drinks', cell: (x) => x.drinks },
              { label: 'Cost of supplies', cell: (x) => formatMoney(x.cost) },
            ]}
          />
        )}
      </div>
    )
  }

  if (tab === 'drivers') {
    const per = (n: number, shifts: number) => formatMoney(shifts ? n / shifts : 0)
    return (
      <div>
        <SectionHead
          title="Drivers"
          csv={
            <CsvButton
              name="drivers.csv"
              rows={[
                ['Lead', 'Shifts', 'Drinks', 'Sales', 'Waste per shift', 'Off by per shift', 'Shifts with something off'],
                ...r.drivers.map((x) => [who(x.user_id), x.shifts, x.drinks, x.revenue, x.shifts ? x.waste / x.shifts : 0, x.shifts ? x.off_cost / x.shifts : 0, x.flagged_shifts]),
              ]}
            />
          }
        >
          Shifts by who led them. "Off by" is how far supplies used were from what sales explain, in dollars.
        </SectionHead>
        <ResponsiveList
          rows={r.drivers}
          rowKey={(x) => x.user_id}
          title={(x) => who(x.user_id) || 'Someone'}
          subtitle={(x) => `${x.shifts} shift${x.shifts === 1 ? '' : 's'} · waste ${per(x.waste, x.shifts)} · off by ${per(x.off_cost, x.shifts)} a shift`}
          badge={(x) => (x.flagged_shifts > 0 ? <Badge tone="amber">{x.flagged_shifts} off</Badge> : <Badge tone="green">On track</Badge>)}
          columns={[
            { label: 'Lead', cell: (x) => <span className="font-medium">{who(x.user_id)}</span> },
            { label: 'Shifts', cell: (x) => x.shifts },
            { label: 'Drinks a shift', cell: (x) => (x.shifts ? Math.round(x.drinks / x.shifts) : 0) },
            { label: 'Waste a shift', cell: (x) => per(x.waste, x.shifts) },
            { label: 'Off by a shift', cell: (x) => per(x.off_cost, x.shifts) },
            { label: 'Shifts off', cell: (x) => x.flagged_shifts },
          ]}
        />
      </div>
    )
  }

  if (tab === 'checks') {
    const cc = r.count_checks
    return (
      <div>
        <SectionHead title="Manager count checks" csv={<CsvButton name="count-checks.csv" rows={[['Done', 'Missed', 'Waiting', 'Counts that differed'], [cc.done, cc.missed, cc.waiting, cc.different]]} />} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Done" value={String(cc.done)} />
          <Tile label="Missed" value={String(cc.missed)} />
          <Tile label="Waiting" value={String(cc.waiting)} />
          <Tile label="Counts that differed" value={String(cc.different)} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <SectionHead
        title="Shifts"
        csv={
          <CsvButton
            name="shifts.csv"
            rows={[
              ['Day', 'Truck', 'Lead', 'Event', 'Drinks', 'Free', 'Sales', 'Supplies used', 'Waste', 'Off by', 'Things off', 'Sales from'],
              ...r.shifts.map((s) => [s.business_date, truckName(s.truck_id), who(s.lead_id), s.event_name ?? '', s.drinks, s.free, s.revenue, s.used, s.waste, s.off_cost, s.flagged, s.source ? groupLabels[s.source] : '']),
            ]}
          />
        }
      />
      <ResponsiveList
        rows={r.shifts}
        rowKey={(s) => s.id}
        title={(s) => `${truckName(s.truck_id)} · ${dayLabel(s.business_date)}`}
        subtitle={(s) => [who(s.lead_id), s.event_name, `${s.drinks} drinks`, `${formatMoney(s.used)} used`].filter(Boolean).join(' · ')}
        badge={(s) => (s.flagged > 0 ? <Badge tone="amber">{s.flagged} off</Badge> : <span className="font-semibold tabular-nums">{formatMoney(s.revenue)}</span>)}
        columns={[
          { label: 'Day', cell: (s) => dayLabel(s.business_date), className: 'whitespace-nowrap' },
          { label: 'Truck', cell: (s) => <span className="font-medium">{truckName(s.truck_id)}</span> },
          { label: 'Lead', cell: (s) => who(s.lead_id) },
          { label: 'Event', cell: (s) => s.event_name ?? '' },
          { label: 'Drinks', cell: (s) => s.drinks },
          { label: 'Sales', cell: (s) => formatMoney(s.revenue) },
          { label: 'Used', cell: (s) => formatMoney(s.used) },
          { label: 'Waste', cell: (s) => formatMoney(s.waste) },
          { label: 'Off', cell: (s) => (s.flagged > 0 ? <Badge tone="amber">{s.flagged}</Badge> : '') },
        ]}
        onSelect={(s) => navigate(`/shifts/${s.id}?step=finish`)}
        actionLabel="Open"
      />
    </div>
  )
}
