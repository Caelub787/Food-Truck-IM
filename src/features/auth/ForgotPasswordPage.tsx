import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button, Field, Notice } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { AuthLayout } from './AuthLayout'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  const send = useAction(async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/set-password?mode=reset`,
    })
    if (error) throw error
    setSent(true)
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send.run()
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to pick a new password.">
      {sent ? (
        <Notice tone="success">If that email has an account, a reset link is on its way. Check your spam folder too.</Notice>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {send.error && <Notice tone="error">{send.error}</Notice>}
          <Field label="Email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" busy={send.busy} full>
            Send reset link
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-6 block text-center font-medium text-brand-700">
        Back to log in
      </Link>
    </AuthLayout>
  )
}
