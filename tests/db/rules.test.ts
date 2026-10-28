import { describe, expect, it } from 'vitest'
import { sql } from './helpers'

// Checks every table against the project rules in CLAUDE.md, so a new table
// can't quietly skip them.

// Only server functions touch these, never the app, so they have no rules for it
// (and nothing to show live): the email outbox, the App Owner list, and the
// record of requests already done (so a phone's retry never runs twice).
const internal = ['outbox', 'app_owners', 'client_requests']

const tables = () =>
  sql<{ name: string; rls: boolean }>(
    `select c.relname as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' order by 1`,
  )

describe('project rules for every table', () => {
  it('every table has row level security on and at least one policy', async () => {
    const all = await tables()
    expect(all.length).toBeGreaterThan(40)
    expect(all.filter((t) => !t.rls).map((t) => t.name)).toEqual([])
    const withPolicies = new Set((await sql<{ t: string }>(`select distinct tablename as t from pg_policies where schemaname = 'public'`)).map((r) => r.t))
    expect(all.map((t) => t.name).filter((n) => !withPolicies.has(n) && !internal.includes(n))).toEqual([])
  })

  it('every company table has a company id that must be filled in', async () => {
    const missing = await sql<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('companies', 'app_owners', 'audit_log', 'outbox')
         and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and a.attnotnull and not a.attisdropped)`,
    )
    expect(missing.map((m) => m.name)).toEqual([])
  })

  it('every company table sends live updates', async () => {
    const missing = await sql<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname <> all ($1)
         and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname like '%\\_live\\_update')`,
      [[...internal, 'audit_log']],
    )
    expect(missing.map((m) => m.name)).toEqual([])
  })

  it('logged out visitors get nothing', async () => {
    const granted = await sql<{ t: string }>(
      `select distinct table_name as t from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'`,
    )
    expect(granted.map((g) => g.t)).toEqual([])
    const fns = await sql<{ f: string }>(
      `select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'execute')`,
    )
    expect(fns.map((f) => f.f)).toEqual([])
  })

  it('every function that skips security rules pins its search path', async () => {
    const loose = await sql<{ f: string }>(
      `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'app') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""')`,
    )
    expect(loose.map((f) => f.f)).toEqual([])
  })
})
