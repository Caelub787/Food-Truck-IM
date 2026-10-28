import { Plus } from 'lucide-react'
import { useState } from 'react'
import { CountInput } from '@/components/CountInput'
import { Badge, Button, Card, Notice } from '@/components/ui'
import { groupLabels, saleGroup, totals, winningGroup, type SaleGroup } from '@/features/sales/data'
import { DrinkSheet } from '@/features/sales/DrinkSheet'
import { useDrinkLabel } from '@/features/sales/useDrinkLabel'
import { tallyKey, useTallyDraft } from '@/features/sales/useTallyDraft'
import { useProducts, useProductSizes, type Named } from '@/features/setup/data'
import { useRows } from '@/lib/data'
import { formatMoney } from '@/lib/units'
import type { ShiftCtx } from './context'
import { SaveState } from './SaveState'
import { ActionBar } from './SupplyCards'

/**
 * Drinks sold on the shift, paid and free. Drivers count them if the business
 * has drivers report sales. Managers can count too, and theirs win over the
 * driver's. A sales file beats both. Every source is kept and compared.
 */
export function SalesStep({ ctx }: { ctx: ShiftCtx }) {
  const { shift } = ctx
  const role = ctx.me.profile?.role
  const reporters = ctx.settings?.sales_reporters ?? 'drivers'
  const mySource = role === 'driver' ? 'driver' : 'manager'
  const canEnter =
    role === 'driver' ? (reporters === 'drivers' || reporters === 'both') && shift.status === 'open' : shift.status !== 'cancelled'
  const mine = ctx.sales.filter((s) => s.source === mySource)
  const draft = useTallyDraft(shift.id, mine)
  const products = useProducts()
  const sizes = useProductSizes()
  const reasons = useRows<Named>('free_reasons', { order: 'sort,name' })
  const drink = useDrinkLabel()
  const [adding, setAdding] = useState(false)

  const truckType = ctx.truck?.truck_type_id
  const productOrder = new Map((products.data ?? []).map((p, i) => [p.id, i]))
  const plain = (sizes.data ?? [])
    .filter((sz) => {
      const p = products.data?.find((x) => x.id === sz.product_id)
      return sz.active && p?.active && (!truckType || !p.truck_type_id || p.truck_type_id === truckType)
    })
    .sort((a, b) => (productOrder.get(a.product_id) ?? 0) - (productOrder.get(b.product_id) ?? 0) || (a.sort ?? 0) - (b.sort ?? 0))
  const lines = draft.lines()
  const extras = lines.filter((l) => l.key.startsWith('x:'))
  const t = lines.reduce(
    (acc, l) => {
      const size = sizes.data?.find((x) => x.id === l.product_size_id)
      acc.drinks += l.quantity
      if (l.is_free) acc.free += l.quantity
      else acc.money += l.quantity * Number(size?.price ?? 0)
      return acc
    },
    { drinks: 0, free: 0, money: 0 },
  )

  const groups = (['file', 'manager', 'driver'] as SaleGroup[]).filter((g) => ctx.sales.some((s) => saleGroup(s.source) === g))
  const winner = winningGroup(ctx.sales, ctx.settings)

  return (
    <div className="space-y-4">
      {canEnter ? (
        <Notice>
          Count drinks as you go or at the end. Tap + for each one sold. Drinks with add ons (like oat milk) and free drinks go in with
          the button below, so the app knows what they used.
        </Notice>
      ) : role === 'driver' ? (
        <Notice>{reporters === 'none' || reporters === 'managers' ? 'Your business has managers handle sales.' : 'This shift is finished.'}</Notice>
      ) : null}

      {groups.length > 0 && (
        <Card>
          <h3 className="font-semibold">Sales on this shift</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {groups.map((g) => {
              const tt = totals(ctx.sales.filter((s) => saleGroup(s.source) === g))
              return (
                <li key={g} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium">{groupLabels[g]}</span>
                  <span className="flex items-center gap-2 text-slate-600">
                    {tt.drinks} drinks · {tt.free} free · {formatMoney(tt.money)}
                    {g === winner && groups.length > 1 && <Badge tone="green">Used</Badge>}
                  </span>
                </li>
              )
            })}
          </ul>
          {groups.length > 1 && (
            <p className="mt-1 text-sm text-slate-500">The app compares usage with the one marked Used, and flags it if the others don't match.</p>
          )}
        </Card>
      )}

      {canEnter && (
        <>
          <h3 className="font-semibold">{role === 'driver' ? 'Your count' : 'Manager count'}</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {plain.map((sz) => {
              const line = { product_size_id: sz.id, modifier_ids: [], is_free: false, free_reason_id: null }
              const key = tallyKey(line)
              return (
                <Card key={sz.id}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="font-semibold">{drink.size(sz.id)}</p>
                    {sz.price != null && <span className="text-sm text-slate-500">{formatMoney(Number(sz.price))}</span>}
                  </div>
                  <CountInput
                    label={`${drink.size(sz.id)} sold`}
                    unit="sold"
                    wholeOnly
                    value={draft.quantity(key) || null}
                    onChange={(v) => draft.set({ ...line, key }, v ?? 0)}
                  />
                </Card>
              )
            })}
          </div>

          {extras.length > 0 && (
            <Card flush className="divide-y divide-slate-100">
              {extras.map((l) => (
                <div key={l.key} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold">{drink.label(l.product_size_id, l.modifier_ids)}</p>
                    {l.is_free && <Badge tone="blue">Free: {reasons.data?.find((r) => r.id === l.free_reason_id)?.name ?? 'no reason'}</Badge>}
                  </div>
                  <div className="md:w-80">
                    <CountInput
                      label={`${drink.label(l.product_size_id, l.modifier_ids)}${l.is_free ? ' free' : ''} count`}
                      unit={l.is_free ? 'free' : 'sold'}
                      wholeOnly
                      value={l.quantity || null}
                      onChange={(v) => draft.set(l, v ?? 0)}
                    />
                  </div>
                </div>
              ))}
            </Card>
          )}

          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-5" aria-hidden /> Drinks with add ons, or free drinks
          </Button>

          <ActionBar>
            <div className="flex flex-col">
              <span className="font-medium">
                {t.drinks} drinks · {t.free} free · {formatMoney(t.money)}
              </span>
              <SaveState status={draft.status} error={draft.error} />
            </div>
          </ActionBar>
          <DrinkSheet open={adding} onClose={() => setAdding(false)} truckTypeId={truckType} onAdd={(line, n) => draft.set(line, draft.quantity(line.key) + n)} />
        </>
      )}
    </div>
  )
}
