import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Button, Field, Notice, Select, Spinner } from '@/components/ui'
import { browserTimeZone, timeZones } from '@/lib/config'
import { rpc, supabase } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { AuthLayout } from './AuthLayout'
import { useMe, useSession } from './session'
import type { PendingCompany } from './SignUpPage'

/** Sign up step two, after the email is confirmed: create the business. */
export function WelcomePage() {
  const { data: me, isLoading } = useMe()
  const { session } = useSession()
  if (isLoading || !session) return <Spinner />
  if (me?.profile) return <Navigate to="/" replace />

  const meta = session.user.user_metadata as { full_name?: string; pending_company?: PendingCompany }
  return <CreateCompanyForm isOwner={Boolean(me?.is_owner)} fullName={meta.full_name ?? ''} pending={meta.pending_company} />
}

function CreateCompanyForm({ isOwner, fullName, pending }: { isOwner: boolean; fullName: string; pending?: PendingCompany }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    companyName: pending?.name ?? '',
    fullName,
    phone: pending?.phone ?? '',
    trucks: pending?.truck_count?.toString() ?? '',
    timezone: pending?.timezone ?? browserTimeZone(),
    note: '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  const create = useAction(async () => {
    await rpc('create_company', {
      p_company_name: form.companyName,
      p_full_name: form.fullName,
      p_phone: form.phone || null,
      p_truck_count: form.trucks ? Number(form.trucks) : null,
      p_timezone: form.timezone,
      p_note: form.note || null,
    })
    await queryClient.invalidateQueries({ queryKey: ['me'] })
    navigate('/', { replace: true })
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void create.run()
  }

  return (
    <AuthLayout title="Your email is confirmed" subtitle="Check your business details, then you're in.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {isOwner && (
          <Notice tone="info">
            You're the app owner. You can set up your own business here, or{' '}
            <Link to="/owner" className="font-semibold underline">
              go straight to the owner section
            </Link>
            .
          </Notice>
        )}
        {create.error && <Notice tone="error">{create.error}</Notice>}
        <Field label="Business name" required value={form.companyName} onChange={set('companyName')} />
        <Field label="Your name" required value={form.fullName} onChange={set('fullName')} />
        <Field label="Phone (optional)" type="tel" value={form.phone} onChange={set('phone')} />
        <Field label="How many trucks? (optional)" type="number" inputMode="numeric" min={0} value={form.trucks} onChange={set('trucks')} />
        <Select label="Time zone" value={form.timezone} onChange={set('timezone')} hint="Used for daily reports and reminders.">
          {timeZones().map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll('_', ' ')}
            </option>
          ))}
        </Select>
        <Field label="Anything we should know? (optional)" value={form.note} onChange={set('note')} />
        <Button type="submit" busy={create.busy} full>
          Finish sign up
        </Button>
        <button type="button" onClick={() => supabase.auth.signOut()} className="text-center text-slate-500">
          Log out
        </button>
      </form>
    </AuthLayout>
  )
}
