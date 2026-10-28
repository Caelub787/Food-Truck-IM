import { describe, expect, it } from 'vitest'
import { as, createCompany, createUser, sql } from './helpers'

async function queue(companyId: string, to: string) {
  const [row] = await sql<{ id: string }>(
    `insert into public.outbox (company_id, channel, to_email, template) values ($1, 'email', $2, 'test') returning id`,
    [companyId, to],
  )
  return row!.id
}

describe('outbox sending', () => {
  it('only the server key can claim messages', async () => {
    const c = await createCompany()
    await expect(as(c.admin, (q) => q(`select * from public.service_claim_outbox(5)`))).rejects.toThrow(
      /permission denied/,
    )
  })

  it('claims each message once, then retries failures with a wait', async () => {
    const c = await createCompany()
    const id = await queue(c.id, 'retry@test.local')

    const first = await as('service', (q) => q(`select id from public.service_claim_outbox(1000)`))
    expect(first.map((r) => r.id)).toContain(id)
    const second = await as('service', (q) => q(`select id from public.service_claim_outbox(1000)`))
    expect(second.map((r) => r.id)).not.toContain(id)

    await as('service', (q) => q(`select public.service_finish_outbox($1, false, 'smtp down')`, [id]))
    const [row] = await sql(`select status, attempts, last_error, send_after > now() as later from public.outbox where id = $1`, [id])
    expect(row).toMatchObject({ status: 'pending', attempts: 1, last_error: 'smtp down', later: true })
  })

  it('gives up after five tries', async () => {
    const c = await createCompany()
    const id = await queue(c.id, 'fail@test.local')
    await sql(`update public.outbox set attempts = 5, status = 'sending' where id = $1`, [id])
    await as('service', (q) => q(`select public.service_finish_outbox($1, false, 'nope')`, [id]))
    const [row] = await sql(`select status from public.outbox where id = $1`, [id])
    expect(row?.status).toBe('failed')
  })

  it('marks sent messages and puts stuck ones back in line', async () => {
    const c = await createCompany()
    const sent = await queue(c.id, 'ok@test.local')
    const stuck = await queue(c.id, 'stuck@test.local')
    await as('service', (q) => q(`select public.service_finish_outbox($1, true)`, [sent]))
    await sql(`update public.outbox set status = 'sending', claimed_at = now() - interval '1 hour' where id = $1`, [stuck])
    await as('service', (q) => q(`select public.service_requeue_stuck_outbox()`))
    const rows = await sql(`select id, status from public.outbox where id = any($1)`, [[sent, stuck]])
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [sent]: 'sent', [stuck]: 'pending' })
  })
})

describe('invite edge cases', () => {
  it('links a confirmed login that has no business, but re invites an unconfirmed one', async () => {
    const c = await createCompany()
    const confirmed = await createUser()
    const unconfirmed = await createUser({ confirmed: false })
    const [a] = await as(c.admin, (q) => q(`select public.can_invite($1, 'driver') as r`, [confirmed.email]))
    expect(a?.r).toEqual({ action: 'attach', user_id: confirmed.id })
    const [b] = await as(c.admin, (q) => q(`select public.can_invite($1, 'driver') as r`, [unconfirmed.email]))
    expect(b?.r).toEqual({ action: 'invite' })
  })
})
