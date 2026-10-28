import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button, Notice } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { AuthLayout } from './AuthLayout'

export function CheckEmailPage() {
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const [resent, setResent] = useState(false)

  const resend = useAction(async () => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/welcome` },
    })
    if (error) throw error
    setResent(true)
  })

  return (
    <AuthLayout
      title="Check your email"
      subtitle={
        <>
          We sent a link to <strong>{email || 'your email'}</strong>. Tap it to confirm your email and finish signing up.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {resend.error && <Notice tone="error">{resend.error}</Notice>}
        {resent && <Notice tone="success">Sent again. It can take a minute, and check your spam folder too.</Notice>}
        {email && (
          <Button variant="secondary" busy={resend.busy} onClick={() => void resend.run()}>
            Send the email again
          </Button>
        )}
        <p className="text-sm text-slate-500">
          If this email already has an account, you won't get a new link.{' '}
          <Link to="/login" className="font-semibold text-brand-700">
            Log in instead
          </Link>
          .
        </p>
      </div>
    </AuthLayout>
  )
}
