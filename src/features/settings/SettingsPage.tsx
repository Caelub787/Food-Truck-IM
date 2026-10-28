import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Toggle } from '@/components/forms'
import { Button, Card, Field, Notice, PageHeader, Select, Spinner } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { num } from '@/lib/data'
import { STATUS_LABELS, timeZones } from '@/lib/config'
import { refreshTables } from '@/lib/live'
import { supabase } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { useSettings, type Settings } from './useSettings'

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })
const sourceLabels = { file: 'Uploaded file (Square or CSV)', manager: 'Manager entry', driver: 'Driver entry' }

export function SettingsPage() {
  const me = useMeLoaded()
  const settings = useSettings()
  return (
    <div>
      <PageHeader title="Business settings" subtitle={`Status: ${STATUS_LABELS[me.company!.status]}`} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <BusinessCard />
        {settings.isLoading && <Spinner />}
        {settings.data && <SettingsForms settings={settings.data} />}
      </div>
    </div>
  )
}

function BusinessCard() {
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
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="font-semibold">Your business</h2>
        {save.error && <Notice tone="error">{save.error}</Notice>}
        {saved && <Notice tone="success">Saved.</Notice>}
        <Field label="Business name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field label="Business phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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
  )
}

function Section({ title, children, onSave, busy, error, saved }: { title: string; children: ReactNode; onSave: () => void; busy: boolean; error: string | null; saved: boolean }) {
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave()
        }}
        className="flex flex-col gap-4"
      >
        <h2 className="font-semibold">{title}</h2>
        {error && <Notice tone="error">{error}</Notice>}
        {saved && <Notice tone="success">Saved.</Notice>}
        {children}
        <Button type="submit" variant="secondary" busy={busy}>
          Save
        </Button>
      </form>
    </Card>
  )
}

function useSaveSettings() {
  const me = useMeLoaded()
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const action = useAction(async (patch: Partial<Settings>) => {
    setSaved(false)
    const { error } = await supabase.from('company_settings').update(patch).eq('company_id', me.company!.id)
    if (error) throw error
    await refreshTables(queryClient, ['company_settings'])
    setSaved(true)
  })
  return { ...action, saved }
}

function SettingsForms({ settings }: { settings: Settings }) {
  const [s, setS] = useState(settings)
  // When someone else changes the settings, show their change, unless this
  // form has unsaved edits of its own.
  const [base, setBase] = useState(settings)
  if (settings !== base) {
    setBase(settings)
    if (JSON.stringify(s) === JSON.stringify(base)) setS(settings)
  }
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS({ ...s, [key]: value })
  const features = useSaveSettings()
  const sales = useSaveSettings()
  const limits = useSaveSettings()
  const timing = useSaveSettings()
  const numberField = (key: keyof Settings) => (e: { target: { value: string } }) => set(key, (num(e.target.value) ?? 0) as never)

  const move = (i: number, by: number) => {
    const order = [...s.sales_source_order]
    const [item] = order.splice(i, 1)
    order.splice(i + by, 0, item!)
    set('sales_source_order', order)
  }

  return (
    <>
      <Section
        title="Features"
        onSave={() =>
          void features.run({
            scheduling_enabled: s.scheduling_enabled,
            loading_checklist_enabled: s.loading_checklist_enabled,
            expiration_tracking: s.expiration_tracking,
            count_checks_enabled: s.count_checks_enabled,
            count_check_blind: s.count_check_blind,
            count_check_manager_wins: s.count_check_manager_wins,
          })
        }
        busy={features.busy}
        error={features.error}
        saved={features.saved}
      >
        <Toggle
          label="Scheduling"
          hint="Build shift schedules in the app and remind drivers who haven't started. Leave off if you use another scheduling app."
          checked={s.scheduling_enabled}
          onChange={(v) => set('scheduling_enabled', v)}
        />
        <Toggle
          label="Loading checklist"
          hint="Drivers check off things like generator fuel and the cash bank before heading out."
          checked={s.loading_checklist_enabled}
          onChange={(v) => set('loading_checklist_enabled', v)}
        />
        <Toggle
          label="Expiration tracking"
          hint="Ask for expiration dates on deliveries of supplies that track them, and warn before they expire."
          checked={s.expiration_tracking}
          onChange={(v) => set('expiration_tracking', v)}
        />
        <Toggle
          label="Manager count checks"
          hint="After a shift, a manager recounts chosen supplies (like cups) to make sure everything lines up."
          checked={s.count_checks_enabled}
          onChange={(v) => set('count_checks_enabled', v)}
        />
        {s.count_checks_enabled && (
          <div className="ml-4 flex flex-col gap-3 border-l-2 border-slate-100 pl-4">
            <Toggle
              label="Blind count"
              hint="Managers don't see the driver's numbers until they enter their own."
              checked={s.count_check_blind}
              onChange={(v) => set('count_check_blind', v)}
            />
            <Toggle
              label="Manager's count wins"
              hint="The manager's count replaces the driver's ending count for checked supplies."
              checked={s.count_check_manager_wins}
              onChange={(v) => set('count_check_manager_wins', v)}
            />
          </div>
        )}
      </Section>

      <Section
        title="Sales"
        onSave={() => void sales.run({ sales_reporters: s.sales_reporters, sales_source_order: s.sales_source_order })}
        busy={sales.busy}
        error={sales.error}
        saved={sales.saved}
      >
        <Select label="Who enters drink counts" value={s.sales_reporters} onChange={(e) => set('sales_reporters', e.target.value as Settings['sales_reporters'])}>
          <option value="drivers">Drivers, at the end of each shift</option>
          <option value="managers">Managers, after each shift</option>
          <option value="both">Both, so they can be compared</option>
          <option value="none">Nobody, we only upload files</option>
        </Select>
        <div>
          <p className="font-medium text-slate-800">Which numbers win when a shift has more than one</p>
          <p className="text-sm text-slate-500">The others are kept and compared. If they don't match, it gets flagged.</p>
          <ol className="mt-2 flex flex-col gap-2">
            {s.sales_source_order.map((source, i) => (
              <li key={source} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <span className="w-6 font-semibold text-slate-500">{i + 1}.</span>
                <span className="flex-1">{sourceLabels[source]}</span>
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded-lg p-2 hover:bg-white disabled:opacity-30">
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === s.sales_source_order.length - 1}
                  onClick={() => move(i, 1)}
                  className="rounded-lg p-2 hover:bg-white disabled:opacity-30"
                >
                  <ArrowDown className="size-4" />
                </button>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <Section
        title="When to flag differences"
        onSave={() =>
          void limits.run({
            diff_percent: s.diff_percent,
            diff_min_dollars: s.diff_min_dollars,
            shift_dollar_limit: s.shift_dollar_limit,
            waste_pattern_factor: s.waste_pattern_factor,
            par_cushion_percent: s.par_cushion_percent,
            par_lookback_shifts: s.par_lookback_shifts,
            par_auto_update: s.par_auto_update,
          })
        }
        busy={limits.busy}
        error={limits.error}
        saved={limits.saved}
      >
        <p className="text-sm text-slate-500">
          A supply is flagged when what was used is off from what the sales say by more than the percent AND more than the dollar amount. Each
          supply can have its own limits.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Off by more than (%)" inputMode="decimal" value={s.diff_percent} onChange={numberField('diff_percent')} />
          <Field label="And more than ($)" inputMode="decimal" value={s.diff_min_dollars} onChange={numberField('diff_min_dollars')} />
          <Field
            label="Whole shift off by more than ($)"
            inputMode="decimal"
            value={s.shift_dollar_limit}
            onChange={numberField('shift_dollar_limit')}
          />
          <Field
            label="Flag a driver's waste at (times the average)"
            inputMode="decimal"
            value={s.waste_pattern_factor}
            onChange={numberField('waste_pattern_factor')}
          />
        </div>
        <h3 className="font-semibold">Par level suggestions</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Look back over this many shifts" inputMode="numeric" value={s.par_lookback_shifts} onChange={numberField('par_lookback_shifts')} />
          <Field label="Extra cushion (%)" inputMode="decimal" value={s.par_cushion_percent} onChange={numberField('par_cushion_percent')} />
        </div>
        <Toggle
          label="Update par levels automatically"
          hint="Off means a manager approves each suggestion with one tap."
          checked={s.par_auto_update}
          onChange={(v) => set('par_auto_update', v)}
        />
      </Section>

      <Section
        title="Timing for reports and reminders"
        onSave={() =>
          void timing.run({
            morning_hour: s.morning_hour,
            daily_report_hour: s.daily_report_hour,
            weekly_report_day: s.weekly_report_day,
            summary_hour: s.summary_hour,
            start_reminder_minutes: s.start_reminder_minutes,
            shift_reminder_hours: s.shift_reminder_hours,
            shift_alert_hours: s.shift_alert_hours,
            count_check_reminder_hours: s.count_check_reminder_hours,
            expiration_warning_days: s.expiration_warning_days,
            photo_retention_days: s.photo_retention_days,
          })
        }
        busy={timing.busy}
        error={timing.error}
        saved={timing.saved}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <HourSelect label="Morning check (low stock, orders, expiration)" value={s.morning_hour} onChange={(v) => set('morning_hour', v)} />
          <HourSelect label="Daily reports go out at" value={s.daily_report_hour} onChange={(v) => set('daily_report_hour', v)} />
          <Select label="Weekly summary on" value={s.weekly_report_day} onChange={(e) => set('weekly_report_day', Number(e.target.value))}>
            {days.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
          <HourSelect label="Weekly and monthly summaries at" value={s.summary_hour} onChange={(v) => set('summary_hour', v)} />
          <Field
            label="Remind if a scheduled shift isn't started after (minutes)"
            inputMode="numeric"
            value={s.start_reminder_minutes}
            onChange={numberField('start_reminder_minutes')}
          />
          <Field
            label="Remind the lead if a shift is open longer than (hours)"
            inputMode="numeric"
            value={s.shift_reminder_hours}
            onChange={numberField('shift_reminder_hours')}
          />
          <Field label="Alert managers after (hours)" inputMode="numeric" value={s.shift_alert_hours} onChange={numberField('shift_alert_hours')} />
          <Field
            label="Remind about a waiting count check after (hours)"
            inputMode="numeric"
            value={s.count_check_reminder_hours}
            onChange={numberField('count_check_reminder_hours')}
          />
          <Field
            label="Warn this many days before things expire"
            inputMode="numeric"
            value={s.expiration_warning_days}
            onChange={numberField('expiration_warning_days')}
          />
          <Field
            label="Keep photos for (days)"
            inputMode="numeric"
            hint="Older photos are cleared to stay within free storage."
            value={s.photo_retention_days}
            onChange={numberField('photo_retention_days')}
          />
        </div>
      </Section>
    </>
  )
}

function HourSelect({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {hourLabel(h)}
        </option>
      ))}
    </Select>
  )
}
