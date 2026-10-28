import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { Button, Field, Notice } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { safeNext } from '@/lib/urls'
import { useAction } from '@/lib/useAction'
import { AuthLayout } from './AuthLayout'
import { useSession } from './session'

export function LoginPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const { session } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const login = useAction(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw error
    navigate(next, { replace: true })
  })

  if (session) return <Navigate to={next} replace />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void login.run()
  }

  return (
    <AuthLayout title="Log in">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {login.error && <Notice tone="error">{login.error}</Notice>}
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" busy={login.busy} full>
          Log in
        </Button>
        <Link to="/forgot-password" className="text-center font-medium text-brand-700">
          Forgot your password?
        </Link>
      </form>
      <div className="mt-10 rounded-2xl bg-brand-50 p-4 text-center">
        <p className="text-slate-700">Own a food truck business?</p>
        <Link to="/signup" className="mt-1 inline-block font-semibold text-brand-700">
          Sign up your business
        </Link>
        <p className="mt-3 text-sm text-slate-500">Drivers and managers: ask your boss for an invite.</p>
      </div>
    </AuthLayout>
  )
}
