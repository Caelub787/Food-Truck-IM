import { describe, expect, it } from 'vitest'
import { addMember, as, createCompany, createUser, makeOwner, sql, uniqueEmail } from './helpers'

describe('sign up', () => {
  it('needs a confirmed email', async () => {
    const user = await createUser({ confirmed: false })
    await expect(as(user, (q) => q(`select public.create_company('Biz', 'Me')`))).rejects.toThrow(
      /confirm your email/,
    )
  })

  it('creates a pending business with the person as admin and tells the App Owner', async () => {
    const owner = uniqueEmail('owner')
    await makeOwner(owner)
    const user = await createUser()
    const [{ id }] = (await as(user, (q) =>
      q(`select public.create_company('Shaved Ice Co', 'Sam', '555 1234', 3, 'America/Denver') as id`),
    )) as [{ id: string }]

    const [company] = await sql(`select status, timezone from public.companies where id = $1`, [id])
    expect(company).toMatchObject({ status: 'pending', timezone: 'America/Denver' })
    const [profile] = await sql(`select role, joined_at from public.profiles where user_id = $1`, [user.id])
    expect(profile?.role).toBe('admin')
    expect(profile?.joined_at).not.toBeNull()
    const mail = await sql(`select template from public.outbox where company_id = $1 and to_email = $2`, [id, owner])
    expect(mail).toEqual([{ template: 'owner_new_signup' }])
  })

  it('falls back to a default time zone when given a bad one', async () => {
    const user = await createUser()
    const [{ id }] = (await as(user, (q) => q(`select public.create_company('Biz', 'Me', null, null, 'Mars/Base') as id`))) as [
      { id: string },
    ]
    const [company] = await sql(`select timezone from public.companies where id = $1`, [id])
    expect(company?.timezone).toBe('America/Chicago')
  })

  it('only lets a person create one business', async () => {
    const { admin } = await createCompany()
    await expect(as(admin, (q) => q(`select public.create_company('Second', 'Me')`))).rejects.toThrow(
      /already belongs to a business/,
    )
  })

  it('auto approves a business made by an App Owner', async () => {
    const user = await createUser()
    await makeOwner(user.email)
    const [{ id }] = (await as(user, (q) => q(`select public.create_company('Owner Co', 'Owner') as id`))) as [
      { id: string },
    ]
    const [company] = await sql(`select status from public.companies where id = $1`, [id])
    expect(company?.status).toBe('active')
  })
})

describe('company separation', () => {
  it('never shows one business to another', async () => {
    const a = await createCompany()
    const b = await createCompany()
    const aDriver = await addMember(a.id, 'driver')

    for (const who of [a.admin, aDriver]) {
      const companies = await as(who, (q) => q(`select id from public.companies`))
      expect(companies.map((c) => c.id)).toEqual([a.id])
      const people = await as(who, (q) => q(`select company_id from public.profiles`))
      expect(people.every((p) => p.company_id === a.id)).toBe(true)
      const other = await as(who, (q) => q(`select * from public.profiles where company_id = $1`, [b.id]))
      expect(other).toEqual([])
    }
  })

  it("won't let an admin edit another business", async () => {
    const a = await createCompany()
    const b = await createCompany()
    await as(a.admin, (q) => q(`update public.companies set name = 'Hacked' where id = $1`, [b.id]))
    const [company] = await sql(`select name from public.companies where id = $1`, [b.id])
    expect(company?.name).not.toBe('Hacked')
  })

  it('gives logged out visitors nothing', async () => {
    await createCompany()
    for (const table of ['companies', 'profiles', 'audit_log', 'outbox', 'app_owners']) {
      await expect(as('anon', (q) => q(`select * from public.${table}`))).rejects.toThrow(/permission denied/)
    }
  })

  it('keeps the outbox and owner list private from logged in people', async () => {
    const a = await createCompany()
    for (const table of ['outbox', 'app_owners']) {
      await expect(as(a.admin, (q) => q(`select * from public.${table}`))).rejects.toThrow(/permission denied/)
    }
  })

  it('shuts out declined and suspended businesses', async () => {
    for (const status of ['declined', 'suspended'] as const) {
      const c = await createCompany(status)
      const companies = await as(c.admin, (q) => q(`select id from public.companies`))
      expect(companies).toEqual([])
      const [{ ctx }] = (await as(c.admin, (q) => q(`select public.my_context() as ctx`))) as [
        { ctx: { company: { status: string } } },
      ]
      expect(ctx.company.status).toBe(status)
    }
  })

  it('shuts out a person who was turned off', async () => {
    const c = await createCompany()
    const driver = await addMember(c.id, 'driver', { active: false })
    expect(await as(driver, (q) => q(`select id from public.companies`))).toEqual([])
    expect(await as(driver, (q) => q(`select user_id from public.profiles`))).toEqual([])
  })
})

describe('company settings', () => {
  it('lets the admin rename the business but not change its status', async () => {
    const c = await createCompany('pending')
    await as(c.admin, (q) => q(`update public.companies set name = 'New Name', timezone = 'America/New_York'`))
    const [row] = await sql(`select name, timezone from public.companies where id = $1`, [c.id])
    expect(row).toMatchObject({ name: 'New Name', timezone: 'America/New_York' })
    await expect(as(c.admin, (q) => q(`update public.companies set status = 'active'`))).rejects.toThrow(
      /permission denied/,
    )
  })

  it('only accepts real time zones', async () => {
    const c = await createCompany()
    await expect(as(c.admin, (q) => q(`update public.companies set timezone = 'Mars/Base'`))).rejects.toThrow(
      /valid time zone/,
    )
  })

  it("doesn't let managers or drivers change company settings", async () => {
    const c = await createCompany()
    for (const role of ['manager', 'driver'] as const) {
      const person = await addMember(c.id, role)
      await as(person, (q) => q(`update public.companies set name = 'Nope'`))
    }
    const [row] = await sql(`select name from public.companies where id = $1`, [c.id])
    expect(row?.name).not.toBe('Nope')
  })
})

describe('App Owner', () => {
  it('only lets App Owners list businesses and change their status', async () => {
    const c = await createCompany('pending')
    await expect(as(c.admin, (q) => q(`select * from public.owner_list_companies()`))).rejects.toThrow(/app owner/)
    await expect(
      as(c.admin, (q) => q(`select public.owner_set_company_status($1, 'active')`, [c.id])),
    ).rejects.toThrow(/app owner/)
  })

  it('needs a confirmed email to count as an App Owner', async () => {
    const user = await createUser({ confirmed: false })
    await makeOwner(user.email)
    await expect(as(user, (q) => q(`select * from public.owner_list_companies()`))).rejects.toThrow(/app owner/)
  })

  it('approves a business, emails its admin, and logs it', async () => {
    const owner = await createUser()
    await makeOwner(owner.email)
    const c = await createCompany('pending')

    const list = await as(owner, (q) => q(`select id, status, admin_email from public.owner_list_companies()`))
    expect(list.find((r) => r.id === c.id)).toMatchObject({ status: 'pending', admin_email: c.admin.email })

    await as(owner, (q) => q(`select public.owner_set_company_status($1, 'active', 'Welcome')`, [c.id]))
    const [row] = await sql(`select status, status_changed_by from public.companies where id = $1`, [c.id])
    expect(row).toMatchObject({ status: 'active', status_changed_by: owner.id })

    const mail = await sql(`select template, payload from public.outbox where company_id = $1 and to_user = $2`, [
      c.id,
      c.admin.id,
    ])
    expect(mail).toHaveLength(1)
    expect(mail[0]).toMatchObject({ template: 'company_status_changed', payload: { status: 'active' } })

    const audit = await sql(
      `select reason from public.audit_log where company_id = $1 and table_name = 'companies' and action = 'update'`,
      [c.id],
    )
    expect(audit.some((a) => a.reason === 'Welcome')).toBe(true)
  })

  it('can see stats', async () => {
    const owner = await createUser()
    await makeOwner(owner.email)
    const [{ stats }] = (await as(owner, (q) => q(`select public.owner_stats() as stats`))) as [
      { stats: { database_bytes: number } },
    ]
    expect(stats.database_bytes).toBeGreaterThan(0)
  })
})

describe('invites', () => {
  it("won't invite while the business is pending", async () => {
    const c = await createCompany('pending')
    await expect(as(c.admin, (q) => q(`select public.can_invite('a@b.com', 'driver')`))).rejects.toThrow(
      /waiting for approval/,
    )
  })

  it('lets admins invite anyone and managers invite drivers only', async () => {
    const c = await createCompany()
    const manager = await addMember(c.id, 'manager')
    const driver = await addMember(c.id, 'driver')

    for (const role of ['admin', 'manager', 'driver']) {
      const [row] = await as(c.admin, (q) => q(`select public.can_invite($1, $2) as r`, [uniqueEmail(), role]))
      expect(row?.r).toEqual({ action: 'invite' })
    }
    const [row] = await as(manager, (q) => q(`select public.can_invite($1, 'driver') as r`, [uniqueEmail()]))
    expect(row?.r).toEqual({ action: 'invite' })
    for (const role of ['admin', 'manager']) {
      await expect(as(manager, (q) => q(`select public.can_invite($1, $2)`, [uniqueEmail(), role]))).rejects.toThrow(
        /permission/,
      )
    }
    await expect(as(driver, (q) => q(`select public.can_invite($1, 'driver')`, [uniqueEmail()]))).rejects.toThrow(
      /permission/,
    )
  })

  it("won't take someone from another business", async () => {
    const a = await createCompany()
    const b = await createCompany()
    const bDriver = await addMember(b.id, 'driver')
    await expect(
      as(a.admin, (q) => q(`select public.can_invite($1, 'driver')`, [bDriver.email.toUpperCase()])),
    ).rejects.toThrow(/another business/)
  })

  it('offers a resend for someone who has not joined yet', async () => {
    const c = await createCompany()
    const invited = await addMember(c.id, 'driver', { joined: false })
    const [row] = await as(c.admin, (q) => q(`select public.can_invite($1, 'driver') as r`, [invited.email]))
    expect(row?.r).toEqual({ action: 'resend', user_id: invited.id })
  })

  it('only lets the server key add members, and still checks permissions', async () => {
    const c = await createCompany()
    const manager = await addMember(c.id, 'manager')
    const newUser = await createUser()
    const args = [manager.id, newUser.id, newUser.email, 'New Person', 'driver']
    const call = `select public.service_add_member($1, $2, $3, $4, $5)`

    await expect(as(c.admin, (q) => q(call, args))).rejects.toThrow(/permission denied/)
    await expect(as('service', (q) => q(call, [manager.id, newUser.id, newUser.email, 'X', 'admin']))).rejects.toThrow(
      /permission/,
    )
    await as('service', (q) => q(call, args))
    const [profile] = await sql(`select company_id, role, invited_by, joined_at from public.profiles where user_id = $1`, [
      newUser.id,
    ])
    expect(profile).toMatchObject({ company_id: c.id, role: 'driver', invited_by: manager.id, joined_at: null })
  })

  it('cancels an invite only before the person joins', async () => {
    const c = await createCompany()
    const invited = await addMember(c.id, 'driver', { joined: false })
    const joined = await addMember(c.id, 'driver')
    await expect(as('service', (q) => q(`select public.service_cancel_invite($1, $2)`, [c.admin.id, joined.id]))).rejects.toThrow(
      /already joined/,
    )
    await as('service', (q) => q(`select public.service_cancel_invite($1, $2)`, [c.admin.id, invited.id]))
    expect(await sql(`select 1 from public.profiles where user_id = $1`, [invited.id])).toEqual([])
  })
})

describe('managing people', () => {
  it('lets managers edit drivers but not managers or admins', async () => {
    const c = await createCompany()
    const manager = await addMember(c.id, 'manager')
    const other = await addMember(c.id, 'manager')
    const driver = await addMember(c.id, 'driver')

    await as(manager, (q) => q(`select public.update_member($1, 'Dee Driver', 'driver')`, [driver.id]))
    await expect(
      as(manager, (q) => q(`select public.update_member($1, 'Dee', 'manager')`, [driver.id])),
    ).rejects.toThrow(/permission/)
    await expect(as(manager, (q) => q(`select public.update_member($1, 'X', 'manager')`, [other.id]))).rejects.toThrow(
      /permission/,
    )
    await expect(as(manager, (q) => q(`select public.set_member_active($1, false)`, [c.admin.id]))).rejects.toThrow(
      /permission/,
    )
    const [row] = await sql(`select full_name from public.profiles where user_id = $1`, [driver.id])
    expect(row?.full_name).toBe('Dee Driver')
  })

  it("won't let a person change their own role or turn themselves off", async () => {
    const c = await createCompany()
    await expect(as(c.admin, (q) => q(`select public.update_member($1, 'Me', 'driver')`, [c.admin.id]))).rejects.toThrow(
      /own role/,
    )
    await expect(as(c.admin, (q) => q(`select public.set_member_active($1, false)`, [c.admin.id]))).rejects.toThrow(
      /yourself/,
    )
  })

  it("can't touch people in another business", async () => {
    const a = await createCompany()
    const b = await createCompany()
    const bDriver = await addMember(b.id, 'driver')
    await expect(as(a.admin, (q) => q(`select public.set_member_active($1, false)`, [bDriver.id]))).rejects.toThrow(
      /not found/,
    )
    await expect(as(a.admin, (q) => q(`select public.update_member($1, 'X', 'driver')`, [bDriver.id]))).rejects.toThrow(
      /not found/,
    )
  })

  it('turning someone off keeps their history and blocks access', async () => {
    const c = await createCompany()
    const driver = await addMember(c.id, 'driver')
    await as(c.admin, (q) => q(`select public.set_member_active($1, false)`, [driver.id]))
    expect(await as(driver, (q) => q(`select id from public.companies`))).toEqual([])
    const [row] = await sql(`select active from public.profiles where user_id = $1`, [driver.id])
    expect(row?.active).toBe(false)
  })

  it('lets anyone update their own name and phone', async () => {
    const c = await createCompany()
    const driver = await addMember(c.id, 'driver')
    await as(driver, (q) => q(`select public.update_my_profile('New Me', '555')`))
    const [row] = await sql(`select full_name, phone from public.profiles where user_id = $1`, [driver.id])
    expect(row).toMatchObject({ full_name: 'New Me', phone: '555' })
  })
})

describe('audit log', () => {
  it('shows changes to admins and managers of the same business only', async () => {
    const a = await createCompany()
    const b = await createCompany()
    const manager = await addMember(a.id, 'manager')
    const driver = await addMember(a.id, 'driver')
    await as(a.admin, (q) => q(`select public.update_member($1, 'Renamed', 'driver')`, [driver.id]))

    for (const who of [a.admin, manager]) {
      const rows = await as(who, (q) => q(`select company_id, actor_id from public.audit_log where row_id = $1`, [driver.id]))
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((r) => r.company_id === a.id)).toBe(true)
    }
    expect(await as(driver, (q) => q(`select * from public.audit_log`))).toEqual([])
    expect(await as(b.admin, (q) => q(`select * from public.audit_log where company_id = $1`, [a.id]))).toEqual([])
  })
})
