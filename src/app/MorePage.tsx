import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { Card, PageHeader } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { useSettings } from '@/features/settings/useSettings'
import { navItems } from './nav'

/** On phones, everything that doesn't fit in the tab bar. */
export function MorePage() {
  const me = useMeLoaded()
  const settings = useSettings()
  const items = navItems(me, settings.data).slice(4)
  return (
    <div>
      <PageHeader title="More" />
      <Card flush className="divide-y divide-slate-100">
        {items.map((item) => (
          <Link key={item.to} to={item.to} className="flex min-h-14 items-center gap-3 px-4 active:bg-slate-50">
            <item.icon className="size-5 text-brand-700" aria-hidden />
            <span className="flex-1 font-medium">{item.label}</span>
            <ChevronRight className="size-5 text-slate-300" aria-hidden />
          </Link>
        ))}
      </Card>
    </div>
  )
}
