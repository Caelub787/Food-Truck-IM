import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { call, level, stockSetup } from './fixtures'
import { addMember, as, createCompany, sql } from './helpers'

describe('deliveries', () => {
  it('adds stock, logs it, and updates the cost', async () => {
    const { c, warehouse, supply } = await stockSetup()
    const milk = await supply('Milk')
    await call(c.admin, 'receive_delivery', {
      location_id: warehouse,
      lines: [{ supply_id: milk, quantity: 384, unit_cost: 0.06 }],
    })
    expect(await level(warehouse, milk)).toBe(384)
    const [move] = await sql(`select kind, unit_cost::float as cost from public.stock_movements where supply_id = $1`, [milk])
    expect(move).toEqual({ kind: 'delivery', cost: 0.06 })
    const [s] = await sql(`select cost_per_base::float as cost from public.supplies where id = $1`, [milk])
    expect(s?.cost).toBe(0.06)
    const [d] = await sql(`select total_cost::float as total from public.deliveries where company_id = $1`, [c.id])
    expect(d?.total).toBeCloseTo(23.04)
  })

  it('does the work once even if the phone sends it twice', async () => {
    const { c, warehouse, supply } = await stockSetup()
    const milk = await supply('Milk')
    const p = { location_id: warehouse, client_id: randomUUID(), lines: [{ supply_id: milk, quantity: 64 }] }
    const [first] = await call(c.admin, 'receive_delivery', p)
    const [second] = await call(c.admin, 'receive_delivery', p)
    expect(second?.r).toBe(first?.r)
    expect(await level(warehouse, milk)).toBe(64)
  })

  it('only admins and managers receive, and only into their own business', async () => {
    const { c, warehouse, supply } = await stockSetup()
    const milk = await supply('Milk')
    const driver = await addMember(c.id, 'driver')
    const other = await stockSetup()
    await expect(call(driver, 'receive_delivery', { location_id: warehouse, lines: [{ supply_id: milk, quantity: 1 }] })).rejects.toThrow(
      /permission/,
    )
    await expect(
      call(other.c.admin, 'receive_delivery', { location_id: warehouse, lines: [{ supply_id: milk, quantity: 1 }] }),
    ).rejects.toThrow(/Pick where/)
    const otherMilk = await other.supply('Milk')
    await expect(
      call(other.c.admin, 'receive_delivery', { location_id: other.warehouse, lines: [{ supply_id: milk, quantity: 1 }] }),
    ).rejects.toThrow(/not found/)
    expect(await level(other.warehouse, otherMilk)).toBe(0)
  })
})

describe('moving and counting', () => {
  it('loading a truck takes it out of the warehouse', async () => {
    const { c, warehouse, truck, supply } = await stockSetup()
    const cups = await supply('Cups', { base_unit: 'each' })
    await call(c.admin, 'receive_delivery', { location_id: warehouse, lines: [{ supply_id: cups, quantity: 1000 }] })
    await call(c.admin, 'transfer_stock', { from_place_id: warehouse, to_place_id: truck, lines: [{ supply_id: cups, quantity: 150 }] })
    expect(await level(warehouse, cups)).toBe(850)
    expect(await level(truck, cups)).toBe(150)
    const kinds = await sql(`select kind from public.stock_movements where supply_id = $1 order by created_at`, [cups])
    expect(kinds.map((k) => k.kind)).toEqual(['delivery', 'load'])
  })

  it('a count sets stock to what was counted and logs the difference', async () => {
    const { c, warehouse, supply } = await stockSetup()
    const milk = await supply('Milk')
    await call(c.admin, 'receive_delivery', { location_id: warehouse, lines: [{ supply_id: milk, quantity: 100 }] })
    await call(c.admin, 'record_count', { place_id: warehouse, lines: [{ supply_id: milk, counted: 90 }] })
    expect(await level(warehouse, milk)).toBe(90)
    const [line] = await sql(`select expected::float, counted::float from public.stock_count_lines where supply_id = $1`, [milk])
    expect(line).toEqual({ expected: 100, counted: 90 })
    const [adj] = await sql(`select quantity::float, from_place_id from public.stock_movements where kind = 'adjustment' and supply_id = $1`, [milk])
    expect(adj).toEqual({ quantity: 10, from_place_id: warehouse })
  })

  it('adjustments need a reason', async () => {
    const { c, warehouse, supply } = await stockSetup()
    const milk = await supply('Milk')
    await expect(as(c.admin, (q) => q(`select public.adjust_stock($1, $2, 5, '')`, [warehouse, milk]))).rejects.toThrow(/reason/)
    await as(c.admin, (q) => q(`select public.adjust_stock($1, $2, -5, 'Found leaking')`, [warehouse, milk]))
    expect(await level(warehouse, milk)).toBe(-5)
  })
})

describe('expiration batches', () => {
  it('moves and uses the oldest batch first', async () => {
    const { c, warehouse, truck, supply } = await stockSetup()
    const milk = await supply('Milk', { tracks_expiration: true })
    await call(c.admin, 'receive_delivery', {
      location_id: warehouse,
      lines: [
        { supply_id: milk, quantity: 64, expires_on: '2026-11-10' },
        { supply_id: milk, quantity: 64, expires_on: '2026-11-03' },
      ],
    })
    await call(c.admin, 'transfer_stock', { from_place_id: warehouse, to_place_id: truck, lines: [{ supply_id: milk, quantity: 80 }] })
    const batches = await sql(
      `select place_id, to_char(expires_on, 'YYYY-MM-DD') as expires, quantity::float as q from public.stock_batches where supply_id = $1 order by place_id, expires_on`,
      [milk],
    )
    const at = (place: string) => batches.filter((b) => b.place_id === place).map((b) => [b.expires, b.q])
    expect(at(truck)).toEqual([
      ['2026-11-03', 64],
      ['2026-11-10', 16],
    ])
    expect(at(warehouse)).toEqual([['2026-11-10', 48]])
  })
})

describe('stock security', () => {
  it('drivers see stock levels but not the log, and nobody sees another business', async () => {
    const { c, warehouse, supply } = await stockSetup()
    const milk = await supply('Milk')
    await call(c.admin, 'receive_delivery', { location_id: warehouse, lines: [{ supply_id: milk, quantity: 10 }] })
    const driver = await addMember(c.id, 'driver')
    expect(await as(driver, (q) => q(`select quantity from public.stock_levels where supply_id = $1`, [milk]))).toHaveLength(1)
    expect(await as(driver, (q) => q(`select * from public.stock_movements`))).toEqual([])
    const other = await createCompany()
    expect(await as(other.admin, (q) => q(`select * from public.stock_levels where supply_id = $1`, [milk]))).toEqual([])
    expect(await as(other.admin, (q) => q(`select * from public.stock_movements where supply_id = $1`, [milk]))).toEqual([])
    await expect(as(c.admin, (q) => q(`update public.stock_levels set quantity = 999`))).rejects.toThrow(/permission denied/)
  })

  it('stock changes go out live', async () => {
    const { c, warehouse, supply } = await stockSetup()
    const milk = await supply('Milk')
    await call(c.admin, 'receive_delivery', { location_id: warehouse, lines: [{ supply_id: milk, quantity: 10 }] })
    const tables = await sql(`select distinct payload ->> 'table' as t from realtime.messages where topic = $1`, [`company:${c.id}`])
    expect(tables.map((t) => t.t)).toEqual(expect.arrayContaining(['stock_levels', 'stock_movements', 'deliveries']))
  })
})
