import { AlertTriangle, BarChart3, Boxes, Building2, CalendarDays, Home, MoreHorizontal, Receipt, Settings2, ShieldCheck, Truck, UserRound, Users, type LucideIcon } from 'lucide-react'
import type { Me } from '@/features/auth/session'
import type { Settings } from '@/features/settings/useSettings'
import type { Role } from '@/lib/config'

export type NavItem = {
  to: string
  label: string
  short: string
  icon: LucideIcon
  roles?: Role[]
  ownerOnly?: boolean
  /** Only shown when this business setting is on. */
  feature?: keyof Settings
}

// In the order they show in the side menu. The first four that apply also go
// in the phone tab bar, and the rest go under "More".
const items: NavItem[] = [
  { to: '/', label: 'Home', short: 'Home', icon: Home },
  { to: '/shifts', label: 'Shifts', short: 'Shifts', icon: Truck },
  { to: '/schedule', label: 'Schedule', short: 'Schedule', icon: CalendarDays, feature: 'scheduling_enabled' },
  { to: '/inventory', label: 'Inventory', short: 'Stock', icon: Boxes, roles: ['admin', 'manager'] },
  { to: '/sales', label: 'Sales', short: 'Sales', icon: Receipt, roles: ['admin', 'manager'] },
  { to: '/reports', label: 'Reports', short: 'Reports', icon: BarChart3, roles: ['admin', 'manager'] },
  { to: '/flags', label: 'Needs a look', short: 'Flags', icon: AlertTriangle, roles: ['admin', 'manager'] },
  { to: '/setup', label: 'Setup', short: 'Setup', icon: Settings2, roles: ['admin', 'manager'] },
  { to: '/people', label: 'People', short: 'People', icon: Users, roles: ['admin', 'manager'] },
  { to: '/settings', label: 'Business settings', short: 'Business', icon: Building2, roles: ['admin'] },
  { to: '/owner', label: 'App owner', short: 'Owner', icon: ShieldCheck, ownerOnly: true },
  { to: '/account', label: 'My account', short: 'Me', icon: UserRound },
]

export const moreItem: NavItem = { to: '/more', label: 'More', short: 'More', icon: MoreHorizontal }

export function navItems(me: Me, settings: Settings | null | undefined): NavItem[] {
  const role = me.profile?.role
  return items.filter((item) => {
    if (item.ownerOnly) return me.is_owner
    if (!me.profile) return item.to === '/account'
    if (item.roles && (!role || !item.roles.includes(role))) return false
    if (item.feature && !settings?.[item.feature]) return false
    return true
  })
}

/** Up to five tabs: the first four, then More if there are more. */
export function tabItems(all: NavItem[]): NavItem[] {
  return all.length <= 5 ? all : [...all.slice(0, 4), moreItem]
}
