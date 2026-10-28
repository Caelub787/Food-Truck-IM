import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { ConfirmButton } from '@/components/ConfirmButton'
import { CountInput } from '@/components/CountInput'
import { EmptyState } from '@/components/forms'
import { Badge, Button, Card, Notice, PageHeader, Spinner } from '@/components/ui'
import { BackLink } from '@/features/setup/BackLink'
import { useSuppliers, useSupplyCatalog, type Catalog } from '@/features/setup/data'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { clean, findUnit, formatAmount, formatMoney } from '@/lib/units'
import { useAction } from '@/lib/useAction'
import { useOrderLines, useOrders, type OrderLine, type PurchaseOrder } from './data'

const TABLES = ['purchase_orders', 'purchase_order_lines', 'outbox']
const statusText: Record<PurchaseOrder['status'], string> = {
  draft: 'Waiting for approval',
  approved: 'Approved, order it',
  sent: 'Ordered',
  received: 'Received',
  cancelled: 'Cancelled',
}

/**
 * Order lists, made every morning for suppliers with things running low.
 * Nothing goes to a supplier until a manager approves it.
 */
export function OrdersPage() {
  const queryClient = useQueryClient()
  const orders = useOrders()
  const lines = useOrderLines()
  const suppliers = useSuppliers()
  const catalog = useSupplyCatalog()
  const build = useAction(async () => {
    await rpc('build_order_lists')
    await refreshTables(queryClient, TABLES)
  })

  if (!orders.data || !lines.data || !catalog.data || !suppliers.data) return <Spinner />
  const supplierName = (id: string) => suppliers.data?.find((s) => s.id === id)?.name ?? 'Supplier'
  const drafts = orders.data.filter((o) => o.status === 'draft')
  const waiting = orders.data.filter((o) => o.status === 'approved' || o.status === 'sent')
  const done = orders.data.filter((o) => o.status === 'received' || o.status === 'cancelled').slice(0, 15)
  const linesOf = (o: PurchaseOrder) => lines.data!.filter((l) => l.order_id === o.id)

  return (
    <div>
      <BackLink to="/inventory" label="Inventory" />
      <PageHeader
        title="Order lists"
        subtitle="Made every morning for suppliers when things run low, enough to get back up to each supply's order up to amount. Nothing is sent until you approve it."
        action={
          <Button variant="secondary" busy={build.busy} onClick={() => void build.run()} className="shrink-0">
            <RefreshCw className="size-5" aria-hidden /> <span className="hidden sm:inline">Check now</span>
          </Button>
        }
      />
      {build.error && <Notice tone="error">{build.error}</Notice>}

      <h2 className="mb-3 text-lg font-bold">To approve</h2>
      {drafts.length === 0 ? (
        <EmptyState title="Nothing to order right now">
          Lists show up here when supplies drop to their reorder level. Set reorder levels and suppliers in Setup, under Supplies.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {drafts.map((o) => (
            <DraftCard key={o.id} order={o} lines={linesOf(o)} catalog={catalog.data!} supplier={suppliers.data!.find((s) => s.id === o.supplier_id)} />
          ))}
        </div>
      )}

      {waiting.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-bold">Waiting to arrive</h2>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {waiting.map((o) => (
              <OpenCard key={o.id} order={o} lines={linesOf(o)} catalog={catalog.data!} supplierName={supplierName(o.supplier_id)} />
            ))}
          </div>
        </>
      )}

      {done.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-bold">Done</h2>
          <Card flush className="divide-y divide-slate-100">
            {done.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{supplierName(o.supplier_id)}</p>
                  <p className="text-sm text-slate-500">
                    {new Date(o.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {linesOf(o).length} items
                  </p>
                </div>
                <Badge tone={o.status === 'received' ? 'green' : 'gray'}>{statusText[o.status]}</Badge>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}

const unitOf = (c: Catalog, supplyId: string) => {
  const s = c.supply(supplyId)!
  return findUnit(c.unitsOf(supplyId), s.purchase_unit_id ?? s.count_unit_id)
}

function DraftCard({
  order,
  lines,
  catalog: c,
  supplier,
}: {
  order: PurchaseOrder
  lines: OrderLine[]
  catalog: Catalog
  supplier: { name: string; order_method: 'email' | 'self'; email: string | null; minimum_order: number | null; order_days: string | null } | undefined
}) {
  const queryClient = useQueryClient()
  const [edits, setEdits] = useState<Record<string, number | null>>({})
  const amount = (l: OrderLine) => (l.supply_id in edits ? edits[l.supply_id]! : Number(l.quantity))
  const changed = Object.keys(edits).length > 0
  const total = lines.reduce((sum, l) => sum + (amount(l) ?? 0) * Number(l.unit_cost), 0)
  const emails = supplier?.order_method === 'email' && supplier.email

  const save = useAction(async () => {
    await rpc('save_purchase_order', { p: { order_id: order.id, lines: lines.map((l) => ({ supply_id: l.supply_id, quantity: amount(l) ?? 0 })) } })
    await refreshTables(queryClient, TABLES)
    setEdits({})
  })
  const approve = useAction(async () => {
    if (changed) await rpc('save_purchase_order', { p: { order_id: order.id, lines: lines.map((l) => ({ supply_id: l.supply_id, quantity: amount(l) ?? 0 })) } })
    await rpc('approve_purchase_order', { p_order_id: order.id })
    await refreshTables(queryClient, TABLES)
  })
  const cancel = useAction(async () => {
    await rpc('set_purchase_order_status', { p_order_id: order.id, p_status: 'cancelled' })
    await refreshTables(queryClient, TABLES)
  })

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{supplier?.name ?? 'Supplier'}</h3>
          <p className="text-sm text-slate-500">
            {emails ? `Approving emails this to ${supplier.email}.` : 'You order this one yourself (phone, website, or store).'}
            {supplier?.order_days && ` Orders: ${supplier.order_days}.`}
          </p>
        </div>
        {order.edited && <Badge tone="blue">Changed</Badge>}
      </div>
      <ul className="mt-3 divide-y divide-slate-100">
        {lines.map((l) => {
          const s = c.supply(l.supply_id)
          const unit = unitOf(c, l.supply_id)
          const v = amount(l)
          return (
            <li key={l.supply_id} className="grid gap-2 py-3 sm:grid-cols-[1fr_16rem] sm:items-center">
              <div>
                <p className="font-medium">{s?.name}</p>
                <p className="text-sm text-slate-500">{formatMoney((v ?? 0) * Number(l.unit_cost))}</p>
              </div>
              <CountInput
                label={`${s?.name} to order`}
                unit={unit.name}
                wholeOnly
                value={v === null ? null : clean(v / unit.factor)}
                onChange={(n) => setEdits({ ...edits, [l.supply_id]: n === null ? null : n * unit.factor })}
              />
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-slate-600">About {formatMoney(total)}</span>
        {supplier?.minimum_order && total < Number(supplier.minimum_order) && (
          <Badge tone="amber">Under their {formatMoney(Number(supplier.minimum_order))} minimum</Badge>
        )}
      </div>
      {(save.error || approve.error || cancel.error) && <Notice tone="error">{save.error ?? approve.error ?? cancel.error}</Notice>}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <ConfirmButton busy={approve.busy} confirmLabel={emails ? 'Tap again to send it' : 'Tap again to approve'} onConfirm={() => void approve.run()} className="flex-1">
          {emails ? 'Approve and email' : 'Approve'}
        </ConfirmButton>
        {changed && (
          <Button variant="secondary" busy={save.busy} onClick={() => void save.run()}>
            Save changes
          </Button>
        )}
        <ConfirmButton variant="ghost" confirmLabel="Tap again to skip it" busy={cancel.busy} onConfirm={() => void cancel.run()}>
          Skip this list
        </ConfirmButton>
      </div>
    </Card>
  )
}

function OpenCard({ order, lines, catalog: c, supplierName }: { order: PurchaseOrder; lines: OrderLine[]; catalog: Catalog; supplierName: string }) {
  const queryClient = useQueryClient()
  const mark = useAction(async (status: 'sent' | 'cancelled') => {
    await rpc('set_purchase_order_status', { p_order_id: order.id, p_status: status })
    await refreshTables(queryClient, TABLES)
  })
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-semibold">{supplierName}</h3>
        <Badge tone={order.status === 'sent' ? 'blue' : 'amber'}>{statusText[order.status]}</Badge>
      </div>
      <ul className="mt-2 list-disc pl-5 text-slate-700">
        {lines.map((l) => (
          <li key={l.supply_id}>
            {c.supply(l.supply_id)?.name}: {formatAmount(Number(l.quantity), unitOf(c, l.supply_id))}
          </li>
        ))}
      </ul>
      {mark.error && <Notice tone="error">{mark.error}</Notice>}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Link
          to={`/inventory/receive?order=${order.id}`}
          className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800"
        >
          It came in
        </Link>
        {order.status === 'approved' && (
          <Button variant="secondary" busy={mark.busy} onClick={() => void mark.run('sent')}>
            I ordered it
          </Button>
        )}
        <ConfirmButton variant="ghost" confirmLabel="Tap again to cancel" busy={mark.busy} onConfirm={() => void mark.run('cancelled')}>
          Cancel
        </ConfirmButton>
      </div>
    </Card>
  )
}
