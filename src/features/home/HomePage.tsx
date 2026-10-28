import { CheckCircle2, Circle, Smartphone } from 'lucide-react'
import { Link, Navigate } from 'react-router'
import { Button, Card } from '@/components/ui'
import { useMeLoaded, type Me } from '@/features/auth/session'
import { useLiveQuery } from '@/lib/live'
import { supabase } from '@/lib/supabase'
import { useInstallPrompt } from './useInstallPrompt'

export function HomePage() {
  const me = useMeLoaded()
  if (!me.profile) return <Navigate to="/owner" replace />
  const firstName = me.profile.full_name.split(' ')[0]

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Hi, {firstName}</h1>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {me.profile.role === 'driver' ? <DriverHome /> : <GettingStarted me={me} />}
        <InstallCard />
      </div>
    </div>
  )
}

function DriverHome() {
  return (
    <Card>
      <h2 className="font-semibold">Your shifts will show up here</h2>
      <p className="mt-1 text-slate-600">
        Starting and ending shifts, truck counts, and loading lists are coming in the next updates. For now, you're all set up.
      </p>
    </Card>
  )
}

function GettingStarted({ me }: { me: Me }) {
  const people = useLiveQuery({
    tables: ['profiles'],
    queryKey: ['people-count', me.company?.id],
    queryFn: async () => {
      const { count, error } = await supabase.from('profiles').select('user_id', { count: 'exact', head: true })
      if (error) throw error
      return count ?? 0
    },
  })

  const steps = [
    { label: 'Sign up your business', done: true },
    { label: 'Get approved', done: me.company?.status === 'active', note: 'We email you when it happens.' },
    { label: 'Invite your managers and drivers', done: (people.data ?? 0) > 1, link: '/people' },
    { label: 'Add your warehouse, trucks, supplies, and products', done: false, note: 'Coming in the next update.' },
  ]

  return (
    <Card>
      <h2 className="font-semibold">Getting started</h2>
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
