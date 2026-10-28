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

/** Wraps plain paragraphs and an optional button in a simple email that reads well on a phone. */
function layout(ctx: TemplateContext, paragraphs: string[], button?: { label: string; url: string }): Rendered['html'] {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('')
  const action = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a></p>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:24px">
<p style="font-weight:700;color:#0f766e;margin:0 0 24px">${escapeHtml(ctx.appName)}</p>
${body}${action}
</div></body></html>`
}

function textVersion(paragraphs: string[], button?: { label: string; url: string }) {
  return [...paragraphs, ...(button ? [`${button.label}: ${button.url}`] : [])].join('\n\n')
}

function build(ctx: TemplateContext, subject: string, paragraphs: string[], button?: { label: string; url: string }): Rendered {
  return { subject, text: textVersion(paragraphs, button), html: layout(ctx, paragraphs, button) }
}

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
