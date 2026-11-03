import { describe, expect, it } from 'vitest'
import { call, insertAs, stockSetup } from './fixtures'
import { addMember, as, createCompany, sql, type Company } from './helpers'

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

  it('keeps bank links locked away: the app sees balances, never tokens, and can not change bank balances', async () => {
    const c = await createCompany()
    const [{ id: link }] = (await as('service', (q) =>
      q(`select public.service_bank_save($1, $2, 'item-1', 'locked-token', 'Main Street Bank') as id`, [c.id, c.admin.id]),
    )) as [{ id: string }]
    await as('service', (q) =>
      q(`select public.service_bank_update($1, $2, 'ok')`, [
        link,
        JSON.stringify([{ account_id: 'acc-1', name: 'Checking', mask: '1234', type: 'depository', current: 5200.5, available: 5100 }]),
      ]),
    )
    const accounts = await as(c.admin, (q) => q(`select name, kind, mask, balance::float as balance from public.money_accounts`))
    expect(accounts).toEqual([{ name: 'Checking', kind: 'bank', mask: '1234', balance: 5200.5 }])
    const [{ r: links }] = (await as(c.admin, (q) => q(`select public.bank_connections() as r`))) as [{ r: Record<string, unknown>[] }]
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ institution: 'Main Street Bank', status: 'ok' })
    expect(JSON.stringify(links)).not.toContain('locked-token')

    await expect(as(c.admin, (q) => q(`select access_token from app.bank_connections`))).rejects.toThrow(/permission/)
    await expect(as(c.admin, (q) => q(`select public.service_bank_list($1)`, [c.id]))).rejects.toThrow(/permission/)
    expect(await as(c.admin, (q) => q(`update public.money_accounts set balance = 1 where kind = 'bank' returning id`))).toEqual([])
    await expect(insertAs(c.admin, 'money_accounts', { name: 'Fake', kind: 'bank' })).rejects.toThrow(/row-level security/)

    // A bank that needs a new login keeps the last balance and says so.
    await as('service', (q) => q(`select public.service_bank_update($1, '[]', 'needs_login', 'Log in again')`, [link]))
    const [{ r: after }] = (await as(c.admin, (q) => q(`select public.bank_connections() as r`))) as [{ r: Record<string, unknown>[] }]
    expect(after[0]).toMatchObject({ status: 'needs_login' })

    await as('service', (q) => q(`select public.service_bank_remove($1, $2)`, [c.id, link]))
    expect(await as(c.admin, (q) => q(`select 1 from public.money_accounts`))).toEqual([])
  })
})
