import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import type { CompanyStatus, Role } from '@/lib/config'
import { rpc } from '@/lib/supabase'

export type Me = {
  user_id: string
  email: string
  is_owner: boolean
  profile: { full_name: string; role: Role; active: boolean; phone: string | null; joined_at: string | null } | null
  company: {
    id: string
    name: string
    status: CompanyStatus
    phone: string | null
    timezone: string
    status_reason: string | null
  } | null
}

export type SessionState = { session: Session | null; loading: boolean }
export const SessionContext = createContext<SessionState>({ session: null, loading: true })

export function useSession() {
  return useContext(SessionContext)
}

/** Who is logged in, their role, and their business. */
export function useMe() {
  const { session } = useSession()
  return useQuery({
    queryKey: ['me', session?.user.id],
    queryFn: () => rpc<Me>('my_context'),
    enabled: Boolean(session),
    staleTime: 60_000,
  })
}

/** For screens that only render once useMe has loaded. */
export function useMeLoaded(): Me {
  const { data } = useMe()
  if (!data) throw new Error('useMeLoaded used before the person loaded')
  return data
}

export function canManagePeople(me: Me) {
  return me.profile?.role === 'admin' || me.profile?.role === 'manager'
}
