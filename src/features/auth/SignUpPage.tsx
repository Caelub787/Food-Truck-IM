import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Field, Notice } from '@/components/ui'
import { APP_NAME, browserTimeZone } from '@/lib/config'
import { supabase } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { AuthLayout } from './AuthLayout'

/** Saved on the login until the email is confirmed, then used to create the business. */
export type PendingCompany = { name: string; phone?: string; truck_count?: number; timezone: string; note?: string }

export function SignUpPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    companyName: '',
    fullName: '',
    phone: '',
    trucks: '',
    email: '',
    password: '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  const signUp = useAction(async () => {
    if (form.password.length < 8) throw new Error('Your password needs at least 8 characters.')
    const pending: PendingCompany = {
      name: form.companyName.trim(),
      phone: form.phone.trim() || undefined,
      truck_count: form.trucks ? Number(form.trucks) : undefined,
      timezone: browserTimeZone(),
    }
    const email = form.email.trim().toLowerCase()
    const { data, error } = await supabase.auth.signUp({
      email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/welcome`,
        data: { full_name: form.fullName.trim(), pending_company: pending },
      },
    })
    if (error) throw error
    // With email confirmation off (local testing) Supabase logs them right in.
    if (data.session) navigate('/welcome', { replace: true })
    else navigate(`/signup/check-email?email=${encodeURIComponent(email)}`, { replace: true })
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void signUp.run()
  }

  return (
    <AuthLayout
      title="Sign up your business"
      subtitle={`Set up ${APP_NAME} for your trucks. We'll review your sign up and email you when you're approved, usually within a day.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {signUp.error && <Notice tone="error">{signUp.error}</Notice>}
        <Field label="Business name" required value={form.companyName} onChange={set('companyName')} autoComplete="organization" />
        <Field label="Your name" required value={form.fullName} onChange={set('fullName')} autoComplete="name" />
        <Field label="Phone (optional)" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
        <Field
          label="How many trucks? (optional)"
          type="number"
          inputMode="numeric"
          min={0}
          max={10000}
          value={form.trucks}
          onChange={set('trucks')}
        />
        <Field label="Email" type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
        <Field
          label="Password"
          type="password"
          required
          minLength={8}
          hint="At least 8 characters."
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
        />
        <Button type="submit" busy={signUp.busy} full>
          Sign up
        </Button>
        <p className="text-center text-slate-600">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-700">
            Log in
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
