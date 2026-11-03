import { describe, expect, it } from 'vitest'
import { call, insertAs, stockSetup } from './fixtures'
import { addMember, as, createCompany, type Company } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sheet = { budgets: any[]; actuals: any[] }

const year = new Date().getUTCFullYear()
const month = new Date().getUTCMonth() + 1
const categories = (who: Parameters<typeof as>[0]) => as(who, (q) => q<{ id: string; name: string; auto: string | null }>(`select id, name, auto from public.budget_categories order by sort`))
const sheet = async (who: Parameters<typeof as>[0]) => (await as(who, (q) => q<{ r: Sheet }>(`select public.budget_year($1) as r`, [year])))[0]!.r
const letManagers = (c: Company, on: boolean) =>
  as(c.admin, (q) => q(`update public.company_settings set budget_managers = $1 where company_id = $2`, [on, c.id]))

describe('budget', () => {
  it('starts every business with categories, and only admins see it unless managers are let in', async () => {
    const c = await createCompany()
    const manager = await addMember(c.id, 'manager')
    const driver = await addMember(c.id, 'driver')
    const names = (await categories(c.admin)).map((x) => x.name)
    expect(names).toEqual(expect.arrayContaining(['Sales', 'Events', 'Inventory', 'Fuel', 'Payroll']))

    expect(await categories(manager)).toEqual([])
    await expect(as(manager, (q) => q(`select public.budget_year($1)`, [year]))).rejects.toThrow(/Only admins/)
    await expect(insertAs(manager, 'money_accounts', { name: 'Cash box', balance: 100 })).rejects.toThrow(/row-level security/)
    await letManagers(c, true)
    expect((await categories(manager)).length).toBe(names.length)
    await insertAs(manager, 'money_accounts', { name: 'Cash box', balance: 100 })

    expect(await categories(driver)).toEqual([])
    await expect(as(driver, (q) => q(`select public.budget_year($1)`, [year]))).rejects.toThrow(/Only admins/)
    const other = await createCompany()
    expect(await as(other.admin, (q) => q(`select 1 from public.money_accounts where company_id = $1`, [c.id]))).toEqual([])
    expect(await as(other.admin, (q) => q(`select 1 from public.budget_categories where company_id = $1`, [c.id]))).toEqual([])
    await expect(insertAs(other.admin, 'budget_entries', {
      company_id: c.id, category_id: (await categories(c.admin))[0]!.id, entry_date: '2026-01-05', amount: 10,
    })).rejects.toThrow(/row-level security|foreign key/)
  })

  it('fills in inventory, sales, and events by itself, next to typed in amounts and the budget', async () => {
    const s = await stockSetup()
    const cats = await categories(s.c.admin)
    const id = (auto: string) => cats.find((x) => x.auto === auto)!.id
    const fuel = cats.find((x) => x.name === 'Fuel')!.id
    const cups = await s.supply('Cups', { base_unit: 'each', cost_per_base: 0.1 })
    await call(s.c.admin, 'receive_delivery', { location_id: s.warehouse, lines: [{ supply_id: cups, quantity: 1000, unit_cost: 0.1 }] })
    await insertAs(s.c.admin, 'budget_entries', { category_id: fuel, entry_date: `${year}-${String(month).padStart(2, '0')}-02`, amount: 80, note: 'Gas' })
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`)
    await as(s.c.admin, (q) => q(`select public.set_budget($1, $2, $3)`, [fuel, months, 150]))

    const r = await sheet(s.c.admin)
    const actual = (cat: string) => Number(r.actuals.find((a) => a.category_id === cat && a.month === month)?.amount ?? 0)
    expect(actual(id('inventory'))).toBe(100)
    expect(actual(fuel)).toBe(80)
    expect(r.budgets.filter((b) => b.category_id === fuel)).toHaveLength(12)
    expect(Number(r.budgets.find((b) => b.category_id === fuel).amount)).toBe(150)
    await expect(as(s.c.admin, (q) => q(`select public.set_budget($1, $2, $3)`, [fuel, months, -1]))).rejects.toThrow(/zero or more/)
  })

  it('keeps typed in balances to the business, and has no bank links at all', async () => {
    const c = await createCompany()
    const driver = await addMember(c.id, 'driver')
    const cash = await insertAs(c.admin, 'money_accounts', { name: 'Cash box', balance: 340 })
    expect(await as(c.admin, (q) => q(`update public.money_accounts set balance = 400 where id = $1 returning balance::int as b`, [cash.id]))).toEqual([{ b: 400 }])
    expect(await as(driver, (q) => q(`select 1 from public.money_accounts`))).toEqual([])
    const other = await createCompany()
    expect(await as(other.admin, (q) => q(`update public.money_accounts set balance = 1 where id = $1 returning id`, [cash.id]))).toEqual([])
    expect(await as(other.admin, (q) => q(`delete from public.money_accounts where id = $1 returning id`, [cash.id]))).toEqual([])

    // Nothing for bank logins is left in the database.
    const leftovers = await as('service', (q) =>
      q(`select (to_regclass('app.bank_connections') is not null) as links,
                exists (select 1 from pg_proc where proname like 'service_bank%' or proname = 'bank_connections') as fns,
                exists (select 1 from information_schema.columns where table_name = 'money_accounts' and column_name in ('kind', 'connection_id')) as cols`),
    )
    expect(leftovers).toEqual([{ links: false, fns: false, cols: false }])
  })
})
