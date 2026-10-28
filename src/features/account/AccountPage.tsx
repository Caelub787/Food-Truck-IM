import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button, Card, Field, Notice, PageHeader } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { ROLE_LABELS } from '@/lib/config'
import { rpc, supabase } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'

export function AccountPage() {
  const me = useMeLoaded()
  return (
    <div className="space-y-4">
      <PageHeader
        title="My account"
        subtitle={me.profile ? `${ROLE_LABELS[me.profile.role]} at ${me.company?.name}` : me.email}
      />
      {me.profile && <ProfileForm />}
      <PasswordForm />
      <Button variant="secondary" full onClick={() => supabase.auth.signOut()}>
        Log out
      </Button>
      <p className="text-center text-xs text-slate-400">Logged in as {me.email}</p>
    </div>
  )
}

function ProfileForm() {
  const me = useMeLoaded()
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({ fullName: me.profile!.full_name, phone: me.profile!.phone ?? '' })

  const save = useAction(async () => {
    setSaved(false)
    await rpc('update_my_profile', { p_full_name: form.fullName, p_phone: form.phone || null })
    await queryClient.invalidateQueries({ queryKey: ['me'] })
    setSaved(true)
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="font-semibold">Your details</h2>
        {save.error && <Notice tone="error">{save.error}</Notice>}
        {saved && <Notice tone="success">Saved.</Notice>}
        <Field label="Name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <Field label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Button type="submit" busy={save.busy}>
          Save
        </Button>
      </form>
    </Card>
  )
}

function PasswordForm() {
  const [password, setPassword] = useState('')
  const [saved, setSaved] = useState(false)

  const save = useAction(async () => {
    setSaved(false)
    if (password.length < 8) throw new Error('Your password needs at least 8 characters.')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    setPassword('')
    setSaved(true)
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="font-semibold">Change password</h2>
        {save.error && <Notice tone="error">{save.error}</Notice>}
        {saved && <Notice tone="success">Password changed.</Notice>}
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          hint="At least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" variant="secondary" busy={save.busy}>
          Change password
        </Button>
      </form>
    </Card>
  )
}
