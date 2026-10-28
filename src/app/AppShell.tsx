import { Building2, Home, ShieldCheck, UserRound, Users, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { useMeLoaded, type Me } from '@/features/auth/session'
import { APP_NAME } from '@/lib/config'
import { UpdatePrompt } from './UpdatePrompt'

type NavItem = { to: string; label: string; icon: LucideIcon }

function navItems(me: Me): NavItem[] {
  const role = me.profile?.role
  const items: NavItem[] = []
  if (me.profile) items.push({ to: '/', label: 'Home', icon: Home })
  if (role === 'admin' || role === 'manager') items.push({ to: '/people', label: 'People', icon: Users })
  if (role === 'admin') items.push({ to: '/settings', label: 'Business', icon: Building2 })
  if (me.is_owner) items.push({ to: '/owner', label: 'Owner', icon: ShieldCheck })
  items.push({ to: '/account', label: 'Me', icon: UserRound })
  return items
}

export function AppShell() {
  const me = useMeLoaded()
  const items = navItems(me)

  return (
    <div className="min-h-dvh sm:flex">
      {/* Side menu on bigger screens */}
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-4 sm:block">
        <Brand me={me} />
        <nav className="mt-6 flex flex-col gap-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-xl px-3 font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`
              }
            >
              <item.icon className="size-5" aria-hidden />
              {item.label === 'Me' ? 'My account' : item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-dvh flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur sm:hidden">
          <div className="flex h-14 items-center">
            <Brand me={me} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-5 pb-28 sm:pb-10">
          <UpdatePrompt />
          {me.company?.status === 'pending' && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>Waiting for approval.</strong> You can look around and get set up. Inviting your team opens up once
              you're approved.
            </div>
          )}
          <Outlet />
        </main>

        {/* Tab bar on phones */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden">
          <div className="mx-auto flex max-w-md">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium ${isActive ? 'text-brand-700' : 'text-slate-500'}`
                }
              >
                <item.icon className="size-6" aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}

function Brand({ me }: { me: Me }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <img src="/favicon.svg" alt="" className="size-8 shrink-0" />
      <div className="min-w-0 leading-tight">
        <p className="font-bold text-brand-700">{APP_NAME}</p>
        {me.company && <p className="truncate text-xs text-slate-500">{me.company.name}</p>}
      </div>
    </div>
  )
}
