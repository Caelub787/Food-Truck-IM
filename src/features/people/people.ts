import type { Me } from '@/features/auth/session'
import type { Role } from '@/lib/config'
import { useLiveQuery } from '@/lib/live'
import { supabase } from '@/lib/supabase'

export type Person = {
  user_id: string
  full_name: string
  email: string
  phone: string | null
  role: Role
  active: boolean
  invited_at: string | null
  joined_at: string | null
}

export function usePeople() {
  return useLiveQuery({
    tables: ['profiles'],
    queryKey: ['people'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, full_name, email, phone, role, active, invited_at, joined_at')
        .order('full_name')
      if (error) throw error
      return data as Person[]
    },
  })
}

/** Admins manage everyone. Managers manage drivers. Matches app.assert_can_manage in the database. */
export function canManage(me: Me, role: Role) {
  const mine = me.profile?.role
  return mine === 'admin' || (mine === 'manager' && role === 'driver')
}

export function rolesICanGive(me: Me): Role[] {
  return me.profile?.role === 'admin' ? ['driver', 'manager', 'admin'] : me.profile?.role === 'manager' ? ['driver'] : []
}

export function personStatus(p: Person): { label: string; tone: 'green' | 'amber' | 'gray' } {
  if (!p.joined_at) return { label: 'Invited', tone: 'amber' }
  if (!p.active) return { label: 'Off', tone: 'gray' }
  return { label: 'Active', tone: 'green' }
}
