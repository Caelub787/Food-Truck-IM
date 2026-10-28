import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button, Field, Notice, Select, Sheet } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { ROLE_LABELS, type Role } from '@/lib/config'
import { callFunction } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { rolesICanGive } from './people'

const resultText = {
  invite: (email: string) => `Invite sent to ${email}. The link works for 24 hours.`,
  resend: (email: string) => `Invite sent again to ${email}.`,
  attach: (email: string) => `${email} already had a login, so we added them and let them know.`,
}

export function InviteSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const me = useMeLoaded()
  const queryClient = useQueryClient()
  const roles = rolesICanGive(me)
  const [form, setForm] = useState<{ fullName: string; email: string; role: Role }>({ fullName: '', email: '', role: 'driver' })

  const invite = useAction(async () => {
    const email = form.email.trim().toLowerCase()
    const result = await callFunction<{ action: keyof typeof resultText }>('manage-invite', {
      action: 'invite',
      email,
      full_name: form.fullName.trim(),
      role: form.role,
    })
    await queryClient.invalidateQueries({ queryKey: ['people'] })
    setForm({ fullName: '', email: '', role: 'driver' })
    onDone(resultText[result.action](email))
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void invite.run()
  }

  return (
    <Sheet title="Invite someone" open={open} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-slate-600">They'll get an email with a link to set their own password.</p>
        {invite.error && <Notice tone="error">{invite.error}</Notice>}
        <Field label="Name" required autoFocus value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <Field
          label="Email"
          type="email"
          required
          autoComplete="off"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        {roles.length > 1 && (
          <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        )}
        <Button type="submit" busy={invite.busy} full>
          Send invite
        </Button>
      </form>
    </Sheet>
  )
}
