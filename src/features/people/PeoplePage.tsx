import { ChevronRight, Search, UserPlus } from 'lucide-react'
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
const roleOrder: Record<Role, number> = { admin: 0, manager: 1, driver: 2 }

function matches(person: Person, search: string) {
  const text = search.trim().toLowerCase()
  if (!text) return true
  return [person.full_name, person.email, person.phone ?? '', ROLE_LABELS[person.role]].some((v) => v.toLowerCase().includes(text))
}

export function PeoplePage() {
  const me = useMeLoaded()
  const people = usePeople()
  const [search, setSearch] = useState('')
  const [inviting, setInviting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const pending = me.company?.status === 'pending'

  const list = (people.data ?? []).filter((p) => matches(p, search))
  // Look the person up from the live list so the panel shows changes others make while it's open.
  const editing = people.data?.find((p) => p.user_id === editingId) ?? null

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

      {(people.data?.length ?? 0) > 5 && (
        <label className="relative mb-4 block md:max-w-sm">
          <span className="sr-only">Find a person</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            placeholder="Find a person"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pr-3 pl-11 outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
          />
        </label>
      )}

      {people.isLoading && <Spinner />}
      {people.error && <Notice tone="error">Couldn't load people. Check your connection and try again.</Notice>}
      {people.data && list.length === 0 && <Card className="text-center text-slate-500">Nobody matches "{search}".</Card>}

      {/* Phones: grouped cards */}
      <div className="space-y-6 md:hidden">
        {groups.map(({ role, title }) => {
          const group = list.filter((p) => p.role === role)
          if (group.length === 0) return null
          return (
            <section key={role}>
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
                {title} ({group.length})
              </h2>
              <Card flush className="divide-y divide-slate-100">
                {group.map((person) => {
                  const status = personStatus(person)
                  return (
                    <button
                      key={person.user_id}
                      onClick={() => setEditingId(person.user_id)}
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

      {/* Tablets and computers: one table */}
      {list.length > 0 && (
        <Card flush className="hidden md:block">
          <table className="w-full text-left">
            <thead className="border-b border-slate-200 bg-slate-50 text-sm text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...list]
                .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.full_name.localeCompare(b.full_name))
                .map((person) => {
                  const status = personStatus(person)
                  return (
                    <tr
                      key={person.user_id}
                      onClick={() => setEditingId(person.user_id)}
                      className="cursor-pointer transition hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 font-medium">
                        {person.full_name}
                        {person.user_id === me.user_id && <span className="font-normal text-slate-400"> (you)</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{person.email}</td>
                      <td className="px-4 py-3 text-slate-600">{person.phone ?? ''}</td>
                      <td className="px-4 py-3 text-slate-600">{ROLE_LABELS[person.role]}</td>
                      <td className="px-4 py-3">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingId(person.user_id)
                          }}
                          className="rounded-lg px-3 py-1.5 font-medium text-brand-700 hover:bg-brand-50"
                        >
                          {person.user_id === me.user_id ? 'View' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </Card>
      )}

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
          key={editing.user_id}
          person={editing}
          onClose={() => setEditingId(null)}
          onDone={(text) => {
            setEditingId(null)
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
