import { useLiveQuery } from '@/lib/live'
import { callFunction, rpc, supabase } from '@/lib/supabase'

export type Category = { id: string; name: string; kind: 'income' | 'expense'; auto: 'inventory' | 'sales' | 'events' | null; sort: number; active: boolean }
export type Entry = { id: string; category_id: string; entry_date: string; amount: number; note: string | null; created_at: string }
export type MoneyAccount = {
  id: string
  name: string
  kind: 'manual' | 'bank'
  institution: string | null
  mask: string | null
  account_type: string | null
  balance: number | null
  available: number | null
  balance_at: string | null
  connection_id: string | null
  active: boolean
  sort: number
}
export type BankLink = { id: string; institution: string | null; status: 'ok' | 'needs_login' | 'error'; error: string | null; last_synced_at: string | null }
type Cell = { category_id: string; month: number; amount: number }
export type YearSheet = { budgets: Cell[]; actuals: Cell[] }

export const autoLabels = { inventory: 'From deliveries', sales: 'From sales', events: 'From booked events' } as const
export const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The first day of a month, like "2026-11-01". */
export const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`

export function useCategories() {
  return useLiveQuery({
    tables: ['budget_categories'],
    queryKey: ['budget-categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('budget_categories').select('*').order('sort').order('name')
      if (error) throw error
      return data as Category[]
    },
  })
}

/** A year of budgets and what really happened, by category and month. */
export function useYear(year: number) {
  return useLiveQuery({
    tables: ['budget_amounts', 'budget_entries', 'budget_categories', 'stock_movements', 'sales', 'bookings'],
    queryKey: ['budget-year', year],
    queryFn: () => rpc<YearSheet>('budget_year', { p_year: year }),
  })
}

export function useEntries(year: number, month: number) {
  const from = monthStart(year, month)
  const to = month === 12 ? monthStart(year + 1, 1) : monthStart(year, month + 1)
  return useLiveQuery({
    tables: ['budget_entries'],
    queryKey: ['budget-entries', from],
    queryFn: async () => {
      const { data, error } = await supabase.from('budget_entries').select('*').gte('entry_date', from).lt('entry_date', to).order('entry_date', { ascending: false })
      if (error) throw error
      return data as Entry[]
    },
  })
}

export function useAccounts() {
  return useLiveQuery({
    tables: ['money_accounts'],
    queryKey: ['money-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('money_accounts').select('*').eq('active', true).order('sort').order('name')
      if (error) throw error
      return data as MoneyAccount[]
    },
  })
}

export function useBankLinks() {
  return useLiveQuery({
    tables: ['bank_connections', 'money_accounts'],
    queryKey: ['bank-links'],
    queryFn: () => rpc<BankLink[]>('bank_connections'),
  })
}

/** Whether bank linking is set up on the server. Off (and quiet) if the function isn't there. */
export function useBankReady() {
  return useLiveQuery({
    tables: [],
    queryKey: ['bank-ready'],
    staleTime: 30 * 60_000,
    queryFn: () => callFunction<{ configured: boolean }>('bank', { action: 'status' }).then((r) => r.configured).catch(() => false),
  })
}

/** Credit cards and loans are money owed, so they count against the total. */
export const signedBalance = (a: MoneyAccount) => (a.account_type === 'credit' || a.account_type === 'loan' ? -1 : 1) * Number(a.balance ?? 0)

/** Totals for a set of cells: what was budgeted and what really happened, by category. */
export function sumBy(cells: Cell[], months: number[]) {
  const out = new Map<string, number>()
  for (const c of cells) if (months.includes(c.month)) out.set(c.category_id, (out.get(c.category_id) ?? 0) + Number(c.amount))
  return out
}

/** How long ago, in plain words: "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function ago(iso: string | null, now = Date.now()) {
  if (!iso) return 'never'
  const minutes = Math.round((now - Date.parse(iso)) / 60000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.round(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}
