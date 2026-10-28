import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button, Field, Notice, Spinner } from '@/components/ui'
import { rpc, supabase } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { AuthLayout } from './AuthLayout'
import { useSession } from './session'

export function SetPasswordPage() {
  const [params] = useSearchParams()
  const isReset = params.get('mode') === 'reset'
  const { session, loading } = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const save = useAction(async () => {
    if (password.length < 8) throw new Error('Your password needs at least 8 characters.')
    if (password !== confirm) throw new Error("The two passwords don't match.")
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    await rpc('mark_joined')
    await queryClient.invalidateQueries({ queryKey: ['me'] })
    navigate('/', { replace: true })
  })

  if (loading) return <Spinner />
  if (!session) {
    return (
      <AuthLayout title="That link has expired">
        <p className="text-slate-600">
          Links work for 24 hours and only once. Ask whoever invited you to send a new invite, or{' '}
          <Link to="/forgot-password" className="font-semibold text-brand-700">
            reset your password
          </Link>
          .
        </p>
      </AuthLayout>
    )
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }

  return (
    <AuthLayout
      title={isReset ? 'Pick a new password' : 'Welcome! Set your password'}
      subtitle={isReset ? undefined : `You'll use ${session.user.email} and this password to log in.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {save.error && <Notice tone="error">{save.error}</Notice>}
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          hint="At least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label="Type it again"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button type="submit" busy={save.busy} full>
          Save password
        </Button>
      </form>
    </AuthLayout>
  )
}
