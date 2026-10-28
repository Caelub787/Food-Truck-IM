import type { EmailOtpType } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Notice, Spinner } from '@/components/ui'
import { friendlyError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from './AuthLayout'

const nextStep: Record<string, string> = {
  invite: '/set-password?mode=invite',
  recovery: '/set-password?mode=reset',
  email_change: '/account',
}

/** Every link in a login email lands here (see supabase/templates). */
export function ConfirmPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const started = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const tokenHash = params.get('token_hash')
  const type = params.get('type') as EmailOtpType | null

  useEffect(() => {
    // Links only work once, so never check the same one twice.
    if (started.current || !tokenHash || !type) return
    started.current = true
    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error: verifyError }) => {
      if (verifyError) setError(friendlyError(verifyError))
      else navigate(nextStep[type] ?? '/welcome', { replace: true })
    })
  }, [tokenHash, type, navigate])

  const problem = !tokenHash || !type ? 'This link is missing something. Try the link in your email again.' : error

  if (!problem) return <Spinner label="Checking your link" />
  return (
    <AuthLayout title="That link didn't work">
      <div className="flex flex-col gap-4">
        <Notice tone="error">{problem}</Notice>
        <p className="text-slate-600">
          Invite links work for 24 hours and only once. Ask whoever invited you to send a new one, or{' '}
          <Link to="/forgot-password" className="font-semibold text-brand-700">
            reset your password
          </Link>{' '}
          if you already set one.
        </p>
        <Link to="/login" className="font-semibold text-brand-700">
          Go to log in
        </Link>
      </div>
    </AuthLayout>
  )
}
