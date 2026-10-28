import nodemailer from 'npm:nodemailer@6'
import { requireEnv } from '../http.ts'

export type Mail = { to: string; subject: string; text: string; html: string }

// Which service sends email is a setting, so switching from Gmail to a paid
// service later (once there's a domain) needs no code changes.
//   EMAIL_PROVIDER=smtp   Gmail or any SMTP server (default). Port 465, since
//                         Edge Functions block ports 25 and 587.
//   EMAIL_PROVIDER=resend Resend HTTPS API
//   EMAIL_PROVIDER=brevo  Brevo HTTPS API
//   EMAIL_PROVIDER=log    Print instead of sending (local testing)
export async function sendMail(mail: Mail): Promise<void> {
  const provider = Deno.env.get('EMAIL_PROVIDER') ?? 'smtp'
  const from = requireEnv('EMAIL_FROM')

  switch (provider) {
    case 'smtp': {
      const transport = nodemailer.createTransport({
        host: Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com',
        port: Number(Deno.env.get('SMTP_PORT') ?? 465),
        secure: true,
        auth: { user: requireEnv('SMTP_USER'), pass: requireEnv('SMTP_PASS') },
      })
      await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html })
      return
    }
    case 'resend': {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      })
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
      return
    }
    case 'brevo': {
      const { name, email } = parseFrom(from)
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': requireEnv('BREVO_API_KEY'), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: { name, email },
          to: [{ email: mail.to }],
          subject: mail.subject,
          textContent: mail.text,
          htmlContent: mail.html,
        }),
      })
      if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`)
      return
    }
    case 'log':
      console.log(`EMAIL to ${mail.to}: ${mail.subject}\n${mail.text}`)
      return
    default:
      throw new Error(`Unknown EMAIL_PROVIDER: ${provider}`)
  }
}

/** Splits "TruckStock <app@gmail.com>" into its name and address. */
export function parseFrom(from: string): { name?: string; email: string } {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (!match) return { email: from.trim() }
  return { name: match[1] || undefined, email: match[2]! }
}
