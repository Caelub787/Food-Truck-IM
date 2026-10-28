import { Navigate, Outlet, useLocation } from 'react-router'
import { Spinner } from '@/components/ui'
import { BlockedPage } from './BlockedPage'
import { useMe, useSession } from './session'

/** Sends logged out visitors to the login page and brings them back after. */
export function RequireSession() {
  const { session, loading } = useSession()
  const location = useLocation()
  if (loading) return <Spinner />
  if (!session) {
    const next = location.pathname + location.search
    return <Navigate to={`/login${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`} replace />
  }
  return <Outlet />
}

/** Only lets in people who belong to a business that is pending or active (or the App Owner). */
export function RequireMember() {
  const { data: me, isLoading, error } = useMe()
  if (isLoading) return <Spinner />
  if (error || !me) return <BlockedPage reason="error" />
  if (!me.profile) return me.is_owner ? <Outlet /> : <Navigate to="/welcome" replace />
  if (!me.profile.active) return <BlockedPage reason="turned_off" />
  if (me.company?.status === 'declined') return <BlockedPage reason="declined" note={me.company.status_reason} />
  if (me.company?.status === 'suspended') return <BlockedPage reason="suspended" note={me.company.status_reason} />
  return <Outlet />
}

export function RequireOwner() {
  const { data: me } = useMe()
  if (!me?.is_owner) return <Navigate to="/" replace />
  return <Outlet />
}

export function RequireRole({ roles }: { roles: ('admin' | 'manager' | 'driver')[] }) {
  const { data: me } = useMe()
  if (!me?.profile || !roles.includes(me.profile.role)) return <Navigate to="/" replace />
  return <Outlet />
}
