import type { Mail } from './mailer.ts'

export type TemplateContext = { appName: string; siteUrl: string }
type Payload = Record<string, unknown>
type Rendered = Omit<Mail, 'to'>

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** A paragraph, a heading, a bullet list, or a small table of numbers. */
type Block = string | { heading: string } | { list: string[] } | { rows: [string, string][] }

function blockHtml(b: Block): string {
  if (typeof b === 'string') return `<p style="margin:0 0 16px">${escapeHtml(b)}</p>`
  if ('heading' in b) return `<p style="margin:24px 0 8px;font-weight:700">${escapeHtml(b.heading)}</p>`
  if ('list' in b) return `<ul style="margin:0 0 16px;padding-left:20px">${b.list.map((i) => `<li style="margin:0 0 4px">${escapeHtml(i)}</li>`).join('')}</ul>`
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 16px">${b.rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;color:#475569">${escapeHtml(k)}</td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600">${escapeHtml(v)}</td></tr>`,
    )
    .join('')}</table>`
}

function blockText(b: Block): string {
  if (typeof b === 'string') return b
  if ('heading' in b) return b.heading.toUpperCase()
  if ('list' in b) return b.list.map((i) => `* ${i}`).join('\n')
  return b.rows.map(([k, v]) => `${k}: ${v}`).join('\n')
}

/** Wraps the blocks and an optional button in a simple email that reads well on a phone. */
function layout(ctx: TemplateContext, blocks: Block[], button?: { label: string; url: string }): Rendered['html'] {
  const body = blocks.map(blockHtml).join('')
  const action = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a></p>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:24px">
<p style="font-weight:700;color:#0f766e;margin:0 0 24px">${escapeHtml(ctx.appName)}</p>
${body}${action}
</div></body></html>`
}

function textVersion(blocks: Block[], button?: { label: string; url: string }) {
  return [...blocks.map(blockText), ...(button ? [`${button.label}: ${button.url}`] : [])].join('\n\n')
}

function build(ctx: TemplateContext, subject: string, blocks: Block[], button?: { label: string; url: string }): Rendered {
  return { subject, text: textVersion(blocks, button), html: layout(ctx, blocks, button) }
}

const money = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`
const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[]
/** Links in payloads are paths inside the app. Anything else is ignored. */
const appLink = (ctx: TemplateContext, path: unknown) => `${ctx.siteUrl}${typeof path === 'string' && path.startsWith('/') ? path : '/'}`

/** "Saturday, May 9, 12:00 PM to 3:00 PM" in the business's time zone. */
export function eventWhen(p: Payload): string {
  const zone = typeof p.timezone === 'string' ? p.timezone : 'America/Chicago'
  const start = new Date(String(p.starts_at))
  const end = new Date(String(p.ends_at))
  const date = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' }).format(start)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
  return `${date}, ${time.format(start)} to ${time.format(end)}`
}

/** Emails to a business's clients carry the business's name, not the app's. */
const asBusiness = (ctx: TemplateContext, p: Payload): TemplateContext => ({ ...ctx, appName: String(p.company_name) })
const replyTo = (p: Payload) => (typeof p.reply_to === 'string' && p.reply_to ? p.reply_to : undefined)
const callLine = (p: Payload) => `Questions? Just reply to this email${p.company_phone ? ` or call ${p.company_phone}` : ''}.`
const noteFrom = (p: Payload): Block[] => (p.message ? [`Note from ${p.company_name}: ${p.message}`] : [])

const templates: Record<string, (p: Payload, ctx: TemplateContext) => Rendered> = {
  owner_new_signup: (p, ctx) =>
    build(
      ctx,
      `New sign up: ${p.company_name}`,
      [
        `${p.admin_name} (${p.admin_email}) signed up ${p.company_name}.`,
        `Phone: ${p.phone || 'not given'}. Trucks: ${p.truck_count ?? 'not given'}.`,
        ...(p.note ? [`Their note: ${p.note}`] : []),
        'Approve or decline it in the owner section.',
      ],
      { label: 'Review sign ups', url: `${ctx.siteUrl}/owner` },
    ),

  company_status_changed: (p, ctx) => {
    const name = String(p.company_name)
    const reason = p.reason ? [`Note from ${ctx.appName}: ${p.reason}`] : []
    const hi = `Hi ${p.admin_name},`
    switch (p.status) {
      case 'active':
        return p.old_status === 'suspended'
          ? build(ctx, `${name} is back on`, [hi, `${name} has been turned back on. Everyone can log in again.`, ...reason], {
              label: 'Open the app',
              url: ctx.siteUrl,
            })
          : build(
              ctx,
              `${name} is approved`,
              [hi, `Good news, ${name} is approved. You can now invite your managers and drivers.`, ...reason],
              { label: 'Open the app', url: ctx.siteUrl },
            )
      case 'declined':
        return build(ctx, `About your ${ctx.appName} sign up`, [
          hi,
          `We weren't able to approve ${name} at this time.`,
          ...reason,
        ])
      case 'suspended':
        return build(ctx, `${name} has been paused`, [
          hi,
          `${name} has been paused, so nobody in your business can log in right now. Your data is safe.`,
          ...reason,
        ])
      default:
        throw new Error(`No email for status ${p.status}`)
    }
  },

  alert: (p, ctx) => build(ctx, String(p.title), [String(p.body ?? '')], { label: 'Open the app', url: appLink(ctx, p.url) }),

  report: (p, ctx) => {
    const kind = String(p.kind)
    const title = kind === 'daily' ? 'Daily report' : kind === 'weekly' ? 'Weekly summary' : 'Monthly summary'
    const profit = Number(p.revenue ?? 0) - Number(p.used ?? 0) - Number(p.waste ?? 0)
    const blocks: Block[] = [
      `${title} for ${p.company_name}, ${p.label}.`,
      {
        rows: [
          ['Shifts finished', String(p.shifts ?? 0)],
          ['Drinks (free)', `${p.drinks ?? 0} (${p.free ?? 0})`],
          ['Sales', money(p.revenue)],
          ['Supplies used', money(p.used)],
          ['Waste', money(p.waste)],
          ['Sales minus supplies and waste', money(profit)],
          ['Shifts with something off', String(p.flagged_shifts ?? 0)],
        ],
      },
    ]
    const trucks = list(p.trucks)
    if (trucks.length > 1) {
      blocks.push({ heading: 'By truck' })
      blocks.push({ list: trucks.map((t) => `${t.name}: ${t.shifts} shifts, ${t.drinks} drinks, ${money(t.revenue)} sales, ${money(t.used)} used, ${money(t.waste)} waste`) })
    }
    const reasons = list(p.waste_reasons)
    if (kind !== 'daily' && reasons.length > 0) {
      blocks.push({ heading: 'Waste by reason' })
      blocks.push({ list: reasons.map((r) => `${r.reason}: ${money(r.cost)}`) })
    }
    const flags = (Array.isArray(p.top_flags) ? p.top_flags : []) as string[]
    if (flags.length > 0) {
      blocks.push({ heading: `Needs a look (${p.open_flags} open)` })
      blocks.push({ list: flags })
    }
    return build(ctx, `${title}: ${p.company_name}`, blocks, { label: 'Open the app', url: ctx.siteUrl })
  },

  morning_summary: (p, ctx) => {
    const blocks: Block[] = [`Good morning. Here's ${p.company_name} for ${p.date}.`]
    const planned = list(p.planned)
    if (planned.length > 0) {
      blocks.push({ heading: 'Going out today' })
      blocks.push({ list: planned.map((s) => `${s.time}: ${s.truck}${s.lead ? `, ${s.lead} leading` : ''}${s.event ? ` (${s.event})` : ''}`) })
    }
    const low = list(p.low)
    if (low.length > 0) {
      blocks.push({ heading: 'Running low' })
      blocks.push({ list: low.map((l) => `${l.name}: ${l.left} left`) })
    }
    const orders = (Array.isArray(p.orders) ? p.orders : []) as string[]
    if (orders.length > 0) {
      blocks.push({ heading: 'Order lists to approve' })
      blocks.push({ list: orders })
    }
    const expiring = (Array.isArray(p.expiring) ? p.expiring : []) as string[]
    if (expiring.length > 0) {
      blocks.push({ heading: 'Expiring' })
      blocks.push({ list: expiring })
    }
    if (Number(p.count_checks) > 0) blocks.push(`${p.count_checks} shift${Number(p.count_checks) === 1 ? ' is' : 's are'} waiting for a count check.`)
    return build(ctx, `Today at ${p.company_name}`, blocks, { label: 'Open the app', url: ctx.siteUrl })
  },

  // Goes to a supplier, outside the business, so it only says what's needed.
  // Replies go to the manager who approved it.
  supplier_order: (p, ctx) => ({
    replyTo: typeof p.reply_to === 'string' ? p.reply_to : undefined,
    ...build(
      ctx,
      `Order from ${p.company_name}`,
      [
        `Hi ${p.contact_name || p.supplier_name},`,
        `${p.company_name} would like to order:`,
        { list: list(p.lines).map((l) => `${l.name}: ${l.amount}`) },
        ...(p.note ? [`Note: ${p.note}`] : []),
        `Questions? Call ${p.company_name}${p.company_phone ? ` at ${p.company_phone}` : ''}${p.approved_by ? ` or ask for ${p.approved_by}` : ''}. Please reply to confirm.`,
      ],
    ),
  }),

  // To a client: their booking request was accepted.
  booking_accepted: (p, ctx) => ({
    replyTo: replyTo(p),
    ...build(asBusiness(ctx, p), `Your booking with ${p.company_name} is confirmed`, [
      `Hi ${p.client_name},`,
      `Good news! ${p.company_name} will be at your event.`,
      { rows: [['When', eventWhen(p)], ['Where', String(p.place)], ...(p.event_name ? [['Event', String(p.event_name)] as [string, string]] : [])] },
      ...noteFrom(p),
      callLine(p),
    ]),
  }),

  booking_declined: (p, ctx) => ({
    replyTo: replyTo(p),
    ...build(
      asBusiness(ctx, p),
      `About your booking request with ${p.company_name}`,
      [`Hi ${p.client_name},`, `Sorry, ${p.company_name} can't make it on ${eventWhen(p)}.`, ...noteFrom(p), 'You\'re welcome to ask for another day.', callLine(p)],
      p.booking_slug ? { label: 'Pick another day', url: `${ctx.siteUrl}/book/${encodeURIComponent(String(p.booking_slug))}` } : undefined,
    ),
  }),

  booking_cancelled: (p, ctx) => ({
    replyTo: replyTo(p),
    ...build(asBusiness(ctx, p), `Your booking with ${p.company_name} was cancelled`, [
      `Hi ${p.client_name},`,
      `${p.company_name} had to cancel your booking for ${eventWhen(p)}.`,
      ...noteFrom(p),
      callLine(p),
    ]),
  }),

  // To the Lead, crew, and manager in charge of an event.
  booking_staff: (p, ctx) => {
    const event = String(p.event_name)
    const subject =
      p.kind === 'cancelled' ? `Event cancelled: ${event}` : p.kind === 'updated' ? `Event changed: ${event}` : `You're on an event: ${event}`
    const opening =
      p.kind === 'cancelled'
        ? `This event at ${p.company_name} was cancelled. It's off the schedule.`
        : p.kind === 'updated'
          ? `This event at ${p.company_name} changed. Here's the latest.`
          : `You're working this event for ${p.company_name}.`
    const crew = list(p.crew).map(String)
    const contact = [p.contact_name, p.contact_phone].filter(Boolean).join(', ')
    const rows: [string, string][] = [
      ['When', eventWhen(p)],
      ['Where', String(p.place)],
      ...(p.truck ? [['Truck', String(p.truck)] as [string, string]] : []),
      ...(p.lead ? [['Lead', String(p.lead)] as [string, string]] : []),
      ...(crew.length ? [['Crew', crew.join(', ')] as [string, string]] : []),
      ...(p.manager ? [['Manager', [p.manager, p.manager_phone].filter(Boolean).join(', ')] as [string, string]] : []),
      ...(contact ? [['On site contact', contact] as [string, string]] : []),
    ]
    const supplies = list(p.supplies).map((l) => `${l.name}: ${l.amount}`)
    return build(
      ctx,
      subject,
      [
        opening,
        { rows },
        ...(supplies.length && p.kind !== 'cancelled' ? [{ heading: 'Bring for this event' }, { list: supplies }] : []),
        ...(p.notes && p.kind !== 'cancelled' ? [`Notes: ${p.notes}`] : []),
      ],
      p.kind === 'cancelled' ? undefined : { label: 'Open the schedule', url: appLink(ctx, p.url) },
    )
  },

  added_to_company: (p, ctx) =>
    build(
      ctx,
      `You've been added to ${p.company_name}`,
      [`Hi ${p.full_name},`, `${p.invited_by_name} added you to ${p.company_name} on ${ctx.appName}. Log in with your email and password.`],
      { label: 'Log in', url: `${ctx.siteUrl}/login` },
    ),
}

export function renderTemplate(template: string, payload: Payload, ctx: TemplateContext): Rendered {
  const render = templates[template]
  if (!render) throw new Error(`Unknown email template: ${template}`)
  return render(payload, ctx)
}
