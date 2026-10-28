import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll } from 'vitest'
import { testUrl } from './config'

const pool = new pg.Pool({ connectionString: testUrl, max: 4 })
afterAll(() => pool.end())

export type Row = Record<string, unknown>
export type Query = <T extends Row = Row>(text: string, params?: unknown[]) => Promise<T[]>
export type User = { id: string; email: string }
export type Who = User | 'anon' | 'service'

/** Runs SQL as the database owner (no security rules apply). */
export async function sql<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params)
  return result.rows as T[]
}

/** Runs queries the way Supabase would for a logged in user, a logged out visitor, or the server key. */
export async function as<T>(who: Who, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (who === 'service') {
      await client.query('set local role service_role')
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })])
    } else if (who === 'anon') {
      await client.query('set local role anon')
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })])
    } else {
      await client.query('set local role authenticated')
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: who.id, email: who.email, role: 'authenticated' }),
      ])
    }
    const q: Query = async (text, params) => (await client.query(text, params)).rows
    const result = await fn(q)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export function uniqueEmail(prefix = 'user') {
  return `${prefix}.${randomUUID().slice(0, 8)}@test.local`
}

export async function createUser(opts: { email?: string; confirmed?: boolean } = {}): Promise<User> {
  const email = (opts.email ?? uniqueEmail()).toLowerCase()
  const [row] = await sql<{ id: string }>(
    `insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id`,
    [email, opts.confirmed === false ? null : new Date()],
  )
  return { id: row!.id, email }
}

export type Company = { id: string; admin: User }

/** Signs up a new business the normal way, then sets its status directly. */
export async function createCompany(status: 'pending' | 'active' | 'declined' | 'suspended' = 'active'): Promise<Company> {
  const admin = await createUser({ email: uniqueEmail('admin') })
  const [row] = await as(admin, (q) =>
    q<{ id: string }>(`select public.create_company($1, $2) as id`, [`Test Co ${admin.email}`, 'Pat Admin']),
  )
  await sql(`update public.companies set status = $2 where id = $1`, [row!.id, status])
  return { id: row!.id, admin }
}

/** Adds a person to a company directly (skips the invite email). */
export async function addMember(
  companyId: string,
  role: 'admin' | 'manager' | 'driver',
  opts: { active?: boolean; joined?: boolean } = {},
): Promise<User> {
  const user = await createUser({ email: uniqueEmail(role) })
  await sql(
    `insert into public.profiles (user_id, company_id, full_name, email, role, active, joined_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [user.id, companyId, `Test ${role}`, user.email, role, opts.active ?? true, opts.joined === false ? null : new Date()],
  )
  return user
}

export async function makeOwner(email: string) {
  await sql(`insert into public.app_owners (email) values (lower($1)) on conflict do nothing`, [email])
}
