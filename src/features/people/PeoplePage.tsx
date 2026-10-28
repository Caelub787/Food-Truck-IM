import { ChevronRight, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, Notice, PageHeader, Spinner } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { ROLE_LABELS, type Role } from '@/lib/config'
import { InviteSheet } from './InviteSheet'
import { usePeople, personStatus, type Person } from './people'
import { PersonSheet } from './PersonSheet'

const groups: { role: Role; title: string }[] = [
  { role: 'admin', title: 'Admins' },
  { role: 'manager', title: 'Managers' },
  { role: 'driver', title: 'Drivers' },
]

export function PeoplePage() {
  const me = useMeLoaded()
  const people = usePeople()
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<Person | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const pending = me.company?.status === 'pending'

  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Everyone who can log in to your business."
        action={
          <Button onClick={() => setInviting(true)} disabled={pending} className="shrink-0">
            <UserPlus className="size-5" aria-hidden /> Invite
          </Button>
        }
      />
      {message && (
        <div className="mb-4">
          <Notice tone="success">{message}</Notice>
        </div>
      )}
      {people.isLoading && <Spinner />}
      {people.error && <Notice tone="error">Couldn't load people. Check your connection and try again.</Notice>}

      <div className="space-y-6">
        {groups.map(({ role, title }) => {
          const list = (people.data ?? []).filter((p) => p.role === role)
          if (list.length === 0) return null
          return (
            <section key={role}>
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
                {title} ({list.length})
              </h2>
              <Card flush className="divide-y divide-slate-100">
                {list.map((person) => {
                  const status = personStatus(person)
                  return (
                    <button
                      key={person.user_id}
                      onClick={() => setEditing(person)}
                      className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {person.full_name}
                          {person.user_id === me.user_id && <span className="text-slate-400"> (you)</span>}
                        </p>
                        <p className="truncate text-sm text-slate-500">{person.email}</p>
                      </div>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <ChevronRight className="size-5 text-slate-300" aria-hidden />
                    </button>
                  )
                })}
              </Card>
            </section>
          )
        })}
      </div>

      <InviteSheet
        open={inviting}
        onClose={() => setInviting(false)}
        onDone={(text) => {
          setInviting(false)
          setMessage(text)
        }}
      />
      {editing && (
        <PersonSheet
          person={editing}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setEditing(null)
            setMessage(text)
          }}
        />
      )}
      <p className="mt-6 text-sm text-slate-500">
        Roles: {ROLE_LABELS.admin}s can do everything. {ROLE_LABELS.manager}s run the warehouse, reports, and drivers.{' '}
        {ROLE_LABELS.driver}s work shifts on the trucks.
      </p>
    </div>
  )
}
