import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Badge, Button, Field, Notice, Select, Sheet } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { ROLE_LABELS, type Role } from '@/lib/config'
import { callFunction, rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { canManage, personStatus, rolesICanGive, type Person } from './people'

export function PersonSheet({ person, onClose, onDone }: { person: Person; onClose: () => void; onDone: (message: string) => void }) {
  const me = useMeLoaded()
  const queryClient = useQueryClient()
  const isMe = person.user_id === me.user_id
  const editable = canManage(me, person.role) && !isMe
  const [form, setForm] = useState({ fullName: person.full_name, phone: person.phone ?? '', role: person.role })
  const status = personStatus(person)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['people'] })

  const save = useAction(async () => {
    await rpc('update_member', { p_user_id: person.user_id, p_full_name: form.fullName, p_role: form.role, p_phone: form.phone || null })
    await refresh()
    onDone(`Saved ${form.fullName}.`)
  })

  const resend = useAction(async () => {
    await callFunction('manage-invite', { action: 'invite', email: person.email, full_name: form.fullName, role: form.role })
    await refresh()
    onDone(`Invite sent again to ${person.email}.`)
  })

  const cancelInvite = useAction(async () => {
    await callFunction('manage-invite', { action: 'cancel', user_id: person.user_id })
    await refresh()
    onDone(`Cancelled the invite for ${person.email}.`)
  })

  const toggleActive = useAction(async () => {
    await rpc('set_member_active', { p_user_id: person.user_id, p_active: !person.active })
    await refresh()
    onDone(person.active ? `${person.full_name} is turned off and can't log in.` : `${person.full_name} is turned back on.`)
  })

  const error = save.error ?? resend.error ?? cancelInvite.error ?? toggleActive.error
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }

  return (
    <Sheet title={person.full_name} open onClose={onClose}>
      <div className="mb-4 flex items-center gap-2 text-slate-600">
        <span className="truncate">{person.email}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {isMe && (
        <Notice tone="info">
          This is you. Change your name, phone, or password on{' '}
          <Link to="/account" className="font-semibold underline">
            your account page
          </Link>
          .
        </Notice>
      )}

      {!isMe && !editable && (
        <dl className="space-y-2 text-slate-700">
          <div>
            <dt className="text-sm text-slate-500">Role</dt>
            <dd>{ROLE_LABELS[person.role]}</dd>
          </div>
          {person.phone && (
            <div>
              <dt className="text-sm text-slate-500">Phone</dt>
              <dd>{person.phone}</dd>
            </div>
          )}
          <p className="pt-2 text-sm text-slate-500">Only admins can change managers and admins.</p>
        </dl>
      )}

      {editable && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Field label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          {rolesICanGive(me).length > 1 && (
            <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {rolesICanGive(me).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          )}
          <Button type="submit" busy={save.busy} full>
            Save
          </Button>

          <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
            {!person.joined_at ? (
              <>
                <Button type="button" variant="secondary" busy={resend.busy} onClick={() => void resend.run()}>
                  Send the invite again
                </Button>
                <ConfirmButton
                  type="button"
                  variant="ghost"
                  className="text-red-600"
                  busy={cancelInvite.busy}
                  confirmLabel="Tap again to cancel the invite"
                  onConfirm={() => void cancelInvite.run()}
                >
                  Cancel invite
                </ConfirmButton>
              </>
            ) : (
              <ConfirmButton
                type="button"
                variant={person.active ? 'ghost' : 'secondary'}
                className={person.active ? 'text-red-600' : undefined}
                busy={toggleActive.busy}
                confirmLabel={person.active ? 'Tap again to turn them off' : 'Tap again to turn them on'}
                onConfirm={() => void toggleActive.run()}
              >
                {person.active ? 'Turn off (keeps their history)' : 'Turn back on'}
              </ConfirmButton>
            )}
          </div>
        </form>
      )}
    </Sheet>
  )
}
