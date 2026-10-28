import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button, Card, Field, Notice, PageHeader, Select } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { STATUS_LABELS, timeZones } from '@/lib/config'
import { supabase } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'

export function SettingsPage() {
  const me = useMeLoaded()
  const company = me.company!
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({ name: company.name, timezone: company.timezone, phone: company.phone ?? '' })

  const save = useAction(async () => {
    setSaved(false)
    const { error } = await supabase
      .from('companies')
      .update({ name: form.name.trim(), timezone: form.timezone, phone: form.phone.trim() || null })
      .eq('id', company.id)
    if (error) throw error
    await queryClient.invalidateQueries({ queryKey: ['me'] })
    setSaved(true)
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }

  return (
    <div>
      <PageHeader title="Business" subtitle={`Status: ${STATUS_LABELS[company.status]}`} />
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {save.error && <Notice tone="error">{save.error}</Notice>}
          {saved && <Notice tone="success">Saved.</Notice>}
          <Field label="Business name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field
            label="Business phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <Select
            label="Time zone"
            hint="Daily reports, reminders, and shift days follow this time zone."
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          >
            {timeZones().map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
          <Button type="submit" busy={save.busy}>
            Save
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-sm text-slate-500">
        Locations, trucks, supplies, products, and feature settings will show up here in the next updates.
      </p>
    </div>
  )
}
