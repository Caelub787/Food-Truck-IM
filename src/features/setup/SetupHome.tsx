import { useQueryClient } from '@tanstack/react-query'
import {
  Boxes,
  Building2,
  CheckCircle2,
  Circle,
  ClipboardList,
  CupSoda,
  FileSpreadsheet,
  ListChecks,
  Sparkles,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button, Card, Notice, PageHeader } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { refreshAllLive } from '@/lib/live'
import { useAction } from '@/lib/useAction'
import { applyKit } from './applyKit'
import { starterKits } from './starterKits'
import { useSetupProgress } from './useSetupProgress'

const sections: { to: string; label: string; text: string; icon: LucideIcon; adminOnly?: boolean }[] = [
  { to: '/setup/locations', label: 'Locations', text: 'Your warehouse and other places that hold stock', icon: Warehouse },
  { to: '/setup/trucks', label: 'Trucks', text: 'Each truck, its type, and where it loads from', icon: Truck },
  { to: '/setup/suppliers', label: 'Suppliers', text: 'Who you buy from and how they take orders', icon: Building2 },
  { to: '/setup/supplies', label: 'Supplies', text: 'Cups, syrup, milk, beans: units, costs, reorder levels', icon: Boxes },
  { to: '/setup/products', label: 'Products', text: 'What you sell, sizes, prices, and recipes', icon: CupSoda },
  { to: '/setup/addons', label: 'Add ons', text: 'Oat milk, extra shots, and what they change', icon: Sparkles },
  { to: '/setup/lists', label: 'Lists', text: 'Truck types, groups, waste reasons, checklist', icon: ListChecks },
  { to: '/setup/import', label: 'Import a spreadsheet', text: 'Add lots of supplies or products at once', icon: FileSpreadsheet },
  { to: '/people', label: 'People', text: 'Invite managers and drivers', icon: Users },
]

export function SetupHome() {
  const me = useMeLoaded()
  const progress = useSetupProgress()
  const p = progress.data
  const steps = p
    ? [
        { label: 'Add your locations', done: p.locations > 0, to: '/setup/locations' },
        { label: 'Add your trucks', done: p.trucks > 0, to: '/setup/trucks' },
        { label: 'Add supplies', done: p.supplies > 0, to: '/setup/supplies' },
        { label: 'Add products and recipes', done: p.products > 0 && p.recipes > 0, to: '/setup/products' },
        { label: 'Add suppliers (for order lists)', done: p.suppliers > 0, to: '/setup/suppliers' },
        { label: 'Invite your team', done: p.people > 1, to: '/people', blocked: me.company?.status !== 'active' },
      ]
    : []

  return (
    <div>
      <PageHeader title="Setup" subtitle="Everything your business sets up once. You can change any of it later." />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <ClipboardList className="size-5 text-brand-700" aria-hidden /> Checklist
          </h2>
          <ol className="mt-3 space-y-2">
            {steps.map((s) => (
              <li key={s.label}>
                <Link to={s.to} className="flex min-h-10 items-center gap-3 rounded-lg px-1 hover:bg-slate-50">
                  {s.done ? (
                    <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-label="Done" />
                  ) : (
                    <Circle className="size-5 shrink-0 text-slate-300" aria-label="Not done yet" />
                  )}
                  <span className={s.done ? 'text-slate-500' : 'font-medium'}>
                    {s.label}
                    {s.blocked && !s.done && <span className="block text-sm font-normal text-slate-500">Opens once you're approved</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
        <div className="lg:col-span-2">
          <StarterKits />
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections
          .filter((s) => !s.adminOnly || me.profile?.role === 'admin')
          .map((s) => (
            <Link key={s.to} to={s.to} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-600 hover:shadow">
              <s.icon className="mt-0.5 size-6 shrink-0 text-brand-700" aria-hidden />
              <div>
                <p className="font-semibold">{s.label}</p>
                <p className="text-sm text-slate-500">{s.text}</p>
              </div>
            </Link>
          ))}
      </div>
    </div>
  )
}

function StarterKits() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const apply = useAction(async (id: string) => {
    setDone(null)
    const kit = starterKits.find((k) => k.id === id)!
    const result = await applyKit(kit, setStep)
    setStep(null)
    setDone(
      `${kit.name} added: ${result.supplies} supplies and ${result.products} products. Costs start at $0, so fill them in on the Supplies page.`,
    )
    await refreshAllLive(queryClient)
  })

  return (
    <Card>
      <h2 className="flex items-center gap-2 font-semibold">
        <Sparkles className="size-5 text-brand-700" aria-hidden /> Starter kits
      </h2>
      <p className="mt-1 text-slate-600">
        Skip the blank page. A kit adds common supplies, products, recipes, and add ons. Anything you already have with the same name is left
        alone, and everything can be changed.
      </p>
      {apply.error && (
        <div className="mt-3">
          <Notice tone="error">{apply.error}</Notice>
        </div>
      )}
      {done && (
        <div className="mt-3">
          <Notice tone="success">{done}</Notice>
        </div>
      )}
      {step && <p className="mt-3 text-sm text-slate-500">{step}…</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {starterKits.map((kit) => (
          <div key={kit.id} className="flex flex-col rounded-xl border border-slate-200 p-4">
            <p className="font-semibold">{kit.name}</p>
            <p className="mt-1 flex-1 text-sm text-slate-500">{kit.description}</p>
            <Button variant="secondary" className="mt-3" busy={apply.busy} onClick={() => void apply.run(kit.id)}>
              Add this kit
            </Button>
          </div>
        ))}
      </div>
    </Card>
  )
}
