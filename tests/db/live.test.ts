import { describe, expect, it } from 'vitest'
import { addMember, as, createCompany, createUser, makeOwner, sql, uniqueEmail, type Who } from './helpers'

async function signals(topic: string) {
  return sql<{ payload: Record<string, unknown>; private: boolean }>(
    `select payload, private from realtime.messages where topic = $1 and event = 'change' order by id`,
    [topic],
  )
}

/** Can this person join the channel? Mirrors Realtime's check against realtime.messages. */
async function canListen(who: Who, topic: string) {
  await sql(`insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'probe')`, [topic])
  const rows = await as(who, async (q) => {
    await q(`select set_config('realtime.topic', $1, true)`, [topic])
    return q<{ n: number }>(`select count(*)::int as n from realtime.messages where topic = $1`, [topic])
  })
  return rows[0]!.n > 0
}

describe('live update signals', () => {
  it('signals the company channel when a person changes, with no row data', async () => {
    const c = await createCompany()
    const driver = await addMember(c.id, 'driver')
    await as(c.admin, (q) => q(`select public.update_member($1, 'New Name', 'driver')`, [driver.id]))

    const sent = await signals(`company:${c.id}`)
    expect(sent.at(-1)).toEqual({ payload: { table: 'profiles', op: 'update' }, private: true })
  })

  it('sends one signal for a big change, not one per row', async () => {
    const c = await createCompany()
    const before = (await signals(`company:${c.id}`)).length
    const users = await Promise.all([1, 2, 3, 4, 5].map(() => createUser({ email: uniqueEmail('bulk') })))
    await sql(
      `insert into public.profiles (user_id, company_id, full_name, email, role)
       select u.id, $1, 'Bulk', u.email, 'driver' from auth.users u where u.id = any($2)`,
      [c.id, users.map((u) => u.id)],
    )
    expect((await signals(`company:${c.id}`)).length).toBe(before + 1)
  })

  it('never signals another company', async () => {
    const a = await createCompany()
    const b = await createCompany()
    const before = (await signals(`company:${b.id}`)).length
    await as(a.admin, (q) => q(`update public.companies set name = 'Changed A'`))
    expect((await signals(`company:${b.id}`)).length).toBe(before)
    expect((await signals(`company:${a.id}`)).at(-1)?.payload).toEqual({ table: 'companies', op: 'update' })
  })

  it('signals the owner channel when a business signs up', async () => {
    const before = (await signals('owner')).length
    await createCompany('pending')
    expect((await signals('owner')).length).toBeGreaterThan(before)
  })
})

describe('who can listen', () => {
  it('lets members hear only their own company', async () => {
    const a = await createCompany()
    const b = await createCompany()
    const driver = await addMember(a.id, 'driver')
    for (const who of [a.admin, driver]) {
      expect(await canListen(who, `company:${a.id}`)).toBe(true)
      expect(await canListen(who, `company:${b.id}`)).toBe(false)
      expect(await canListen(who, 'owner')).toBe(false)
    }
  })

  it('shuts out logged out visitors, turned off people, and paused businesses', async () => {
    const a = await createCompany()
    const off = await addMember(a.id, 'driver', { active: false })
    const paused = await createCompany('suspended')
    await expect(canListen('anon', `company:${a.id}`)).rejects.toThrow(/permission denied/)
    expect(await canListen(off, `company:${a.id}`)).toBe(false)
    expect(await canListen(paused.admin, `company:${paused.id}`)).toBe(false)
  })

  it('lets App Owners hear the owner channel', async () => {
    const owner = await createUser()
    await makeOwner(owner.email)
    expect(await canListen(owner, 'owner')).toBe(true)
  })
})
