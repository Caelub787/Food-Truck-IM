import { CalendarCheck, ChevronLeft, ChevronRight, Phone } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { TextArea } from '@/components/forms'
import { Button, Card, Field, Notice, Select, Spinner } from '@/components/ui'
import { APP_NAME } from '@/lib/config'
import { rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { useBookingPage, type BookingPageInfo } from './data'
import { dayStatus, endTimes, localBusy, monthGrid, startTimes, timeLabel } from './slots'

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const blank = { name: '', email: '', phone: '', organization: '', event_name: '', place: '', guests: '', notes: '', website: '' }

/**
 * A business's public booking page. Clients pick a day and time and tell the
 * business about their event. No login. The business accepts or declines.
 */
export function BookingPage() {
  const { slug = '' } = useParams()
  const page = useBookingPage(slug)

  return (
    <div className="min-h-dvh bg-slate-50">
      {page.isLoading && <Spinner />}
      {!page.isLoading && !page.data && (
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <h1 className="text-2xl font-bold">This booking page isn't open</h1>
          <p className="mt-2 text-slate-600">The business may have turned off online bookings. Please contact them directly.</p>
        </div>
      )}
      {page.data && <Booking slug={slug} info={page.data} />}
      <p className="pb-8 text-center text-sm text-slate-400">Bookings by {APP_NAME}</p>
      {import.meta.env.VITE_DEMO === '1' && (
        <p className="pb-8 text-center">
          <Link to="/bookings" className="font-semibold text-brand-700">
            Demo: back to the app
          </Link>
        </p>
      )}
    </div>
  )
}

function Booking({ slug, info }: { slug: string; info: BookingPageInfo }) {
  const busy = useMemo(() => localBusy(info), [info])
  const [month, setMonth] = useState(() => ({ year: Number(info.first_day.slice(0, 4)), month: Number(info.first_day.slice(5, 7)) - 1 }))
  const [date, setDate] = useState<string | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [form, setForm] = useState(blank)
  const [sent, setSent] = useState<string | null>(null)
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  const starts = date ? startTimes(info, busy, date) : []
  const ends = date && start ? endTimes(info, busy, date, start) : []
  const monthKey = `${month.year}-${String(month.month + 1).padStart(2, '0')}`
  const canBack = monthKey > info.first_day.slice(0, 7)
  const canNext = monthKey < info.last_day.slice(0, 7)
  const shift = (by: number) => {
    const d = new Date(Date.UTC(month.year, month.month + by, 1))
    setMonth({ year: d.getUTCFullYear(), month: d.getUTCMonth() })
  }
  const pick = (day: string) => {
    setDate(day)
    setStart('')
    setEnd('')
  }
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const send = useAction(async () => {
    if (!date || !start || !end) throw new Error('Pick a day and a start and end time first.')
    await rpc('request_booking', { p_slug: slug, p: { ...form, date, start, end } })
    setSent(form.email.trim())
    setForm(blank)
    setDate(null)
    setStart('')
    setEnd('')
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send.run()
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Card className="text-center">
          <CalendarCheck className="mx-auto size-12 text-brand-700" aria-hidden />
          <h1 className="mt-3 text-2xl font-bold">Request sent!</h1>
          <p className="mt-2 text-slate-600">
            {info.name} will look it over and email you at <strong>{sent}</strong> once they've decided.
          </p>
          <Button variant="secondary" className="mt-6" onClick={() => setSent(null)}>
            Ask for another day
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <p className="font-semibold text-brand-700">Book a food truck</p>
          <h1 className="text-3xl font-bold tracking-tight">{info.name}</h1>
          {info.intro && <p className="mt-2 max-w-2xl whitespace-pre-line text-slate-600">{info.intro}</p>}
          {info.phone && (
            <a href={`tel:${info.phone}`} className="mt-2 inline-flex min-h-11 items-center gap-2 font-medium text-brand-700">
              <Phone className="size-4" aria-hidden /> {info.phone}
            </a>
          )}
        </div>
      </header>

      <form onSubmit={submit} className="mx-auto grid max-w-5xl items-start gap-4 px-4 py-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold">1. Pick a day</h2>
          <div className="mt-3 flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} disabled={!canBack} aria-label="Earlier month" className="grid size-12 place-items-center rounded-xl hover:bg-slate-100 disabled:opacity-30">
              <ChevronLeft className="size-5" />
            </button>
            <p className="font-semibold">{new Date(Date.UTC(month.year, month.month, 15)).toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
            <button type="button" onClick={() => shift(1)} disabled={!canNext} aria-label="Later month" className="grid size-12 place-items-center rounded-xl hover:bg-slate-100 disabled:opacity-30">
              <ChevronRight className="size-5" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
            {weekdays.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label="Days">
            {monthGrid(month.year, month.month).map((day, i) => {
              if (!day) return <span key={`blank-${i}`} />
              const status = dayStatus(info, busy, day)
              const picked = day === date
              return (
                <button
                  key={day}
                  type="button"
                  disabled={status !== 'open'}
                  onClick={() => pick(day)}
                  aria-pressed={picked}
                  aria-label={`${day}${status === 'full' ? ', booked' : status === 'open' ? '' : ', not open'}`}
                  className={`flex min-h-12 flex-col items-center justify-center rounded-xl text-sm font-semibold transition ${
                    picked
                      ? 'bg-brand-700 text-white'
                      : status === 'open'
                        ? 'bg-white ring-1 ring-slate-200 hover:bg-brand-50 hover:ring-brand-600'
                        : status === 'full'
                          ? 'bg-slate-100 text-slate-400 line-through'
                          : 'text-slate-300'
                  }`}
                >
                  {Number(day.slice(8))}
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-sm text-slate-500">Crossed out days are already booked.</p>

          <h2 className="mt-6 text-lg font-semibold">2. Pick a time</h2>
          {!date ? (
            <p className="mt-2 text-slate-500">Pick a day first.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Select
                label="Start"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value)
                  setEnd('')
                }}
              >
                <option value="">Pick</option>
                {starts.map((t) => (
                  <option key={t.time} value={t.time} disabled={!t.free}>
                    {timeLabel(t.time)}
                    {t.free ? '' : ' (booked)'}
                  </option>
                ))}
              </Select>
              <Select label="End" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!start}>
                <option value="">Pick</option>
                {ends.map((t) => (
                  <option key={t} value={t}>
                    {timeLabel(t)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {localZone !== info.timezone && (
            <p className="mt-3 text-sm text-slate-500">Times are in the business's time zone ({info.timezone.replaceAll('_', ' ')}).</p>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">3. Tell them about your event</h2>
          <div className="mt-3 flex flex-col gap-4">
            {send.error && <Notice tone="error">{send.error}</Notice>}
            <Field label="Your name" required autoComplete="name" value={form.name} onChange={set('name')} maxLength={120} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} maxLength={200} />
              <Field label="Phone" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} maxLength={40} />
            </div>
            <Field label="School, company, or group (optional)" value={form.organization} onChange={set('organization')} maxLength={120} />
            <Field label="What's the event?" placeholder="Spring fair, wedding, team lunch" value={form.event_name} onChange={set('event_name')} maxLength={120} />
            <Field label="Where is it?" required placeholder="Street address" autoComplete="street-address" value={form.place} onChange={set('place')} maxLength={300} />
            <Field label="About how many people?" inputMode="numeric" value={form.guests} onChange={set('guests')} maxLength={6} />
            <TextArea label="Anything else they should know? (optional)" rows={3} value={form.notes} onChange={set('notes')} maxLength={2000} />
            {/* Only robots fill this in. */}
            <div aria-hidden="true" className="hidden">
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
              </label>
            </div>
            {date && start && end && (
              <Notice>
                Asking for {new Date(`${date}T12:00:00Z`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })},{' '}
                {timeLabel(start)} to {timeLabel(end)}.
              </Notice>
            )}
            <Button type="submit" busy={send.busy} full>
              Send request
            </Button>
            <p className="text-sm text-slate-500">This is a request. Nothing is booked until {info.name} accepts it. No payment is taken here.</p>
          </div>
        </Card>
      </form>
    </>
  )
}
