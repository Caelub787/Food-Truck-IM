import { CheckCircle2, Circle, Smartphone } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Button, Card } from '@/components/ui'
import { useMeLoaded, type Me } from '@/features/auth/session'
import { FlagsCard } from '@/features/flags/FlagsCard'
import { useSetupProgress } from '@/features/setup/useSetupProgress'
import { CountChecksCard } from '@/features/shifts/CountChecksCard'
import { GoingNow, MyShiftCard } from '@/features/shifts/ShiftsPage'
import { useInstallPrompt } from './useInstallPrompt'

export function HomePage() {
  const me = useMeLoaded()
  const navigate = useNavigate()
  if (!me.profile) return <Navigate to="/owner" replace />
  const firstName = me.profile.full_name.split(' ')[0]

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Hi, {firstName}</h1>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {me.profile.role === 'driver' ? (
          <MyShiftCard onStart={() => navigate('/shifts?start=1')} />
        ) : (
          <>
            <GettingStarted me={me} />
            <FlagsCard />
            <CountChecksCard />
          </>
        )}
        <GoingNow />
        <InstallCard />
      </div>
    </div>
  )
}

function GettingStarted({ me }: { me: Me }) {
  const progress = useSetupProgress()
  const p = progress.data
  if (!p) return null
  const steps = [
    { label: 'Sign up your business', done: true },
    { label: 'Get approved', done: me.company?.status === 'active', note: 'We email you when it happens.' },
    { label: 'Add your trucks and locations', done: p.trucks > 0, link: '/setup/trucks' },
    { label: 'Add supplies', done: p.supplies > 0, link: '/setup/supplies' },
    { label: 'Add products and recipes', done: p.products > 0 && p.recipes > 0, link: '/setup/products' },
    { label: 'Invite your managers and drivers', done: p.people > 1, link: '/people' },
  ]
  if (steps.every((s) => s.done)) return null

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Getting started</h2>
        <Link to="/setup" className="text-sm font-medium text-brand-700">
          Open setup
        </Link>
      </div>
      <ol className="mt-3 space-y-3">
        {steps.map((step) => (
          <li key={step.label} className="flex gap-3">
            {step.done ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-label="Done" />
            ) : (
              <Circle className="mt-0.5 size-5 shrink-0 text-slate-300" aria-label="Not done yet" />
            )}
            <div>
              {step.link && !step.done ? (
                <Link to={step.link} className="font-medium text-brand-700">
                  {step.label}
                </Link>
              ) : (
                <span className={step.done ? 'text-slate-500' : 'font-medium'}>{step.label}</span>
              )}
              {step.note && !step.done && <p className="text-sm text-slate-500">{step.note}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function InstallCard() {
  const install = useInstallPrompt()
  if (install.installed) return null
  return (
    <Card className="flex gap-3">
      <Smartphone className="mt-0.5 size-6 shrink-0 text-brand-700" aria-hidden />
      <div className="flex-1">
        <h2 className="font-semibold">Put the app on your home screen</h2>
        {install.canPrompt ? (
          <>
            <p className="mt-1 text-slate-600">It opens like a normal app and works with weak signal.</p>
            <Button className="mt-3" onClick={() => void install.prompt()}>
              Add to home screen
            </Button>
          </>
        ) : install.isIos ? (
          <p className="mt-1 text-slate-600">
            In Safari, tap the Share button, then <strong>Add to Home Screen</strong>. You need this for reminders on an iPhone.
          </p>
        ) : (
          <p className="mt-1 text-slate-600">
            Open your browser menu and pick <strong>Install app</strong> or <strong>Add to Home screen</strong>.
          </p>
        )}
      </div>
    </Card>
  )
}
