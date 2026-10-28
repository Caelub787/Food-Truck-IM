import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Toggle } from '@/components/forms'
import { Card, Notice } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { refreshTables, useLiveQuery } from '@/lib/live'
import { currentPush, pushKey, pushSupported, turnOffPush, turnOnPush } from '@/lib/push'
import { supabase } from '@/lib/supabase'

type Prefs = Record<'daily_email' | 'weekly_email' | 'monthly_email' | 'morning_email' | 'alert_email' | 'alert_push' | 'reminder_push', boolean | null>

const options: { key: keyof Prefs; label: string; hint: string; roles: string[] }[] = [
  { key: 'reminder_push', label: 'Shift reminders', hint: 'When a planned shift should start, or a shift is still open.', roles: ['admin', 'manager', 'driver'] },
  { key: 'alert_push', label: 'Alerts as notifications', hint: 'Low stock, order lists, things that look off.', roles: ['admin', 'manager'] },
  { key: 'alert_email', label: 'Alerts by email too', hint: 'The same alerts, in your inbox.', roles: ['admin', 'manager'] },
  { key: 'morning_email', label: 'Morning email', hint: "What's low, expiring, or waiting for you.", roles: ['admin', 'manager'] },
  { key: 'daily_email', label: 'Daily report', hint: 'Shifts, sales, usage, and waste for the day.', roles: ['admin', 'manager'] },
  { key: 'weekly_email', label: 'Weekly summary', hint: 'The week by truck, with waste reasons.', roles: ['admin', 'manager'] },
  { key: 'monthly_email', label: 'Monthly summary', hint: 'Last month, with sales minus costs.', roles: ['admin', 'manager'] },
]

// What each role gets when they haven't chosen (matches app.recipients).
const defaults: Record<string, (keyof Prefs)[]> = {
  admin: ['reminder_push', 'alert_push', 'morning_email', 'daily_email', 'weekly_email', 'monthly_email'],
  manager: ['reminder_push', 'alert_push', 'morning_email', 'daily_email', 'weekly_email'],
  driver: ['reminder_push'],
}

/** Which emails and notifications this person gets, and push on this device. */
export function NotificationsCard() {
  const me = useMeLoaded()
  const queryClient = useQueryClient()
  const role = me.profile?.role ?? 'driver'
  const prefs = useLiveQuery({
    tables: ['notification_settings'],
    queryKey: ['notification-settings', me.user_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_settings').select('*').eq('user_id', me.user_id).maybeSingle()
      if (error) throw error
      return data as Prefs | null
    },
  })
  const [device, setDevice] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void currentPush().then((s) => setDevice(Boolean(s)))
  }, [])

  const value = (key: keyof Prefs) => prefs.data?.[key] ?? defaults[role]!.includes(key)
  const setPref = async (key: keyof Prefs, on: boolean) => {
    setError(null)
    const { error: e } = await supabase.from('notification_settings').upsert({ user_id: me.user_id, [key]: on }, { onConflict: 'user_id' })
    if (e) setError(e.message)
    await refreshTables(queryClient, ['notification_settings'])
  }
  const setDevicePush = async (on: boolean) => {
    setBusy(true)
    setError(null)
    try {
      if (on) await turnOnPush()
      else await turnOffPush()
      setDevice(on)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!me.profile) return null
  return (
    <Card>
      <h2 className="font-semibold">Notifications</h2>
      <div className="mt-2 divide-y divide-slate-100">
        <div className="pb-3">
          {pushSupported() && pushKey ? (
            <Toggle
              label="Notifications on this device"
              hint="Turn this on for each phone or computer you use."
              checked={Boolean(device)}
              disabled={busy || device === null}
              onChange={(on) => void setDevicePush(on)}
            />
          ) : (
            <p className="text-sm text-slate-500">
              {pushKey ? 'This browser can\'t show notifications. On an iPhone, add the app to your home screen first.' : 'Notifications aren\'t set up for this app yet.'}
            </p>
          )}
        </div>
        {options
          .filter((o) => o.roles.includes(role))
          .map((o) => (
            <div key={o.key} className="py-2">
              <Toggle label={o.label} hint={o.hint} checked={value(o.key)} onChange={(on) => void setPref(o.key, on)} />
            </div>
          ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </Card>
  )
}
