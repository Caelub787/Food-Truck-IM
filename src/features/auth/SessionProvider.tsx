import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { SessionContext, type SessionState } from './session'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true })
  const queryClient = useQueryClient()

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setState({ session: data.session, loading: false })
    })
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, loading: false })
      if (event === 'SIGNED_OUT') queryClient.clear()
    })
    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [queryClient])

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
}
