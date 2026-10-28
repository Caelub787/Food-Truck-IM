import { Building2, Home, LogOut, ShieldCheck, UserRound, Users, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { useMeLoaded, type Me } from '@/features/auth/session'
import { LiveBadge } from '@/features/live/LiveBadge'
import { APP_NAME, ROLE_LABELS } from '@/lib/config'
import { supabase } from '@/lib/supabase'
import { UpdatePrompt } from './UpdatePrompt'

type NavItem = { to: string; label: string; short: string; icon: LucideIcon }

function navItems(me: Me): NavItem[] {
  const role = me.profile?.role
  const items: NavItem[] = []
  if (me.profile) items.push({ to: '/', label: 'Home', short: 'Home', icon: Home })
  if (role === 'admin' || role === 'manager') items.push({ to: '/people', label: 'People', short: 'People', icon: Users })
  if (role === 'admin') items.push({ to: '/settings', label: 'Business settings', short: 'Business', icon: Building2 })
  if (me.is_owner) items.push({ to: '/owner', label: 'App owner', short: 'Owner', icon: ShieldCheck })
  items.push({ to: '/account', label: 'My account', short: 'Me', icon: UserRound })
  return items
}

/**
 * The frame around every logged in screen. Phones get a top bar and a tab bar
 * at the bottom. Tablets and computers get a menu down the left side.
 */
export function AppShell() {
  const me = useMeLoaded()
  const items = navItems(me)

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:sticky md:top-0 md:flex md:h-dvh">
        <div className="p-5">
          <Brand me={me} />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-xl px-3 font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100'
                }`
              }
            >
              <item.icon className="size-5" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          {me.profile && (
            <div className="mb-3 min-w-0">
              <p className="truncate font-medium">{me.profile.full_name}</p>
              <p className="truncate text-sm text-slate-500">{ROLE_LABELS[me.profile.role]}</p>
            </div>
          )}
          <div className="flex items-center justify-between">
            <LiveBadge />
            <button
              onClick={() => supabase.auth.signOut()}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <LogOut className="size-4" aria-hidden /> Log out
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
          <div className="flex h-14 items-center justify-between gap-3">
            <Brand me={me} />
            <LiveBadge />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-12">
          <UpdatePrompt />
          {me.company?.status === 'pending' && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>Waiting for approval.</strong> You can look around and get set up. Inviting your team opens up once
              you're approved.
            </div>
          )}
          <Outlet />
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          <div className="mx-auto flex max-w-md">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium ${
                    isActive ? 'text-brand-700' : 'text-slate-500'
                  }`
                }
              >
                <item.icon className="size-6" aria-hidden />
                {item.short}
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
