// Works out which days and times are open on a business's booking page. Times
// are in the business's time zone (where the event happens), written as
// "2026-05-09T12:00" so they compare as plain text.

export type BookingRules = {
  timezone: string
  days: number[]
  open: string
  close: string
  first_day: string
  last_day: string
  capacity: number
  busy: { starts_at: string; ends_at: string }[]
}

const STEP = 30

/** "2026-05-09T12:00" for a moment in time, in a time zone. */
export function localStamp(iso: string, zone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Every half hour from open up to close, like ["08:00", "08:30", ...]. */
export function steps(open: string, close: string): string[] {
  const out: string[] = []
  for (let m = toMinutes(open); m <= toMinutes(close); m += STEP) out.push(fromMinutes(m))
  return out
}

/** "1:30 PM" */
export function timeLabel(t: string): string {
  const m = toMinutes(t)
  const h = Math.floor(m / 60) % 24
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** The day of the week (0 is Sunday) for "2026-05-09". */
export const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()

/** The busy times as local stamps, worked out once per page. */
export function localBusy(rules: BookingRules) {
  return rules.busy.map((b) => ({ s: localStamp(b.starts_at, rules.timezone), e: localStamp(b.ends_at, rules.timezone) }))
}

type Busy = ReturnType<typeof localBusy>

/** How many busy times overlap from..to on a day. */
export function busyCount(busy: Busy, date: string, from: string, to: string): number {
  const a = `${date}T${from}`
  const b = `${date}T${to}`
  return busy.filter((x) => x.s < b && a < x.e).length
}

const freeStep = (rules: BookingRules, busy: Busy, date: string, t: string) =>
  busyCount(busy, date, t, fromMinutes(toMinutes(t) + STEP)) < rules.capacity

export type DayStatus = 'out' | 'closed' | 'full' | 'open'

/** Whether a day can be picked, and if not, why. */
export function dayStatus(rules: BookingRules, busy: Busy, date: string): DayStatus {
  if (date < rules.first_day || date > rules.last_day) return 'out'
  if (!rules.days.includes(weekday(date))) return 'closed'
  return steps(rules.open, rules.close).slice(0, -1).some((t) => freeStep(rules, busy, date, t)) ? 'open' : 'full'
}

/** Start times on a day, and whether each one is free. */
export function startTimes(rules: BookingRules, busy: Busy, date: string) {
  return steps(rules.open, rules.close)
    .slice(0, -1)
    .map((time) => ({ time, free: freeStep(rules, busy, date, time) }))
}

/** End times that keep the whole event free, from half an hour after the start up to closing. */
export function endTimes(rules: BookingRules, busy: Busy, date: string, start: string): string[] {
  const out: string[] = []
  for (let m = toMinutes(start); m < toMinutes(rules.close); m += STEP) {
    if (!freeStep(rules, busy, date, fromMinutes(m))) break
    out.push(fromMinutes(m + STEP))
  }
  return out
}

/** The days of a month laid out by week, starting on Sunday, with blanks before the 1st. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return [...Array<null>(first).fill(null), ...Array.from({ length: count }, (_, i) => `${year}-${pad(month + 1)}-${pad(i + 1)}`)]
}
