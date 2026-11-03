import { Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EmptyState, Segmented } from '@/components/forms'
import { ResponsiveList } from '@/components/ResponsiveList'
import { Badge, Button, Card, Notice, PageHeader, Spinner } from '@/components/ui'
import { useMeLoaded } from '@/features/auth/session'
import { useSettings } from '@/features/settings/useSettings'
import { useTrucks } from '@/features/setup/data'
import { BookingSheet } from './BookingSheet'
import { statusLabels, useBookings, whenText, type Booking } from './data'

type Tab = 'waiting' | 'upcoming' | 'past' | 'closed'
const tones = { pending: 'amber', accepted: 'green', declined: 'gray', cancelled: 'gray' } as const

/** Requests from clients on the booking page, and every booked event. */
export function BookingsPage() {
  const me = useMeLoaded()
  const settings = useSettings()
  const bookings = useBookings()
  const trucks = useTrucks()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('waiting')
  const [copied, setCopied] = useState(false)

  const slug = settings.data?.booking_slug
  const pageUrl = slug ? `${window.location.origin}/book/${slug}` : ''
  const all = bookings.data?.bookings ?? []
  const [now] = useState(() => Date.now())
  const groups: Record<Tab, Booking[]> = {
    waiting: all.filter((b) => b.status === 'pending').sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    upcoming: all.filter((b) => b.status === 'accepted' && Date.parse(b.ends_at) >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    past: all.filter((b) => b.status === 'accepted' && Date.parse(b.ends_at) < now),
    closed: all.filter((b) => b.status === 'declined' || b.status === 'cancelled'),
  }
  const rows = groups[tab]
  const openId = params.get('open')
  const open = all.find((b) => b.id === openId)
  const setOpen = (id: string | null) => setParams(id ? { open: id } : {}, { replace: true })
  const truckName = (id: string | null) => trucks.data?.find((t) => t.id === id)?.name ?? ''

  const copy = async () => {
    await navigator.clipboard?.writeText(pageUrl).catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <PageHeader title="Bookings" subtitle="Clients ask for a truck on your booking page. Accept or decline them here, and the crew gets everything they need." />

      {settings.data && !settings.data.bookings_enabled ? (
        <Notice>
          Your booking page is off.{' '}
          {me.profile?.role === 'admin' ? (
            <Link to="/settings" className="font-semibold underline">
              Turn it on in Business settings
            </Link>
          ) : (
            'An admin can turn it on in Business settings.'
          )}
          .
        </Notice>
      ) : (
        pageUrl && (
          <Card className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-slate-500">Your booking page. Share it on your website, social media, or in emails.</p>
              <p className="truncate font-semibold">{pageUrl}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" onClick={() => void copy()}>
                <Copy className="size-5" aria-hidden /> {copied ? 'Copied' : 'Copy link'}
              </Button>
              {/* The demo runs in one page, so it opens there. */}
              <Link to={`/book/${slug}`} target={import.meta.env.VITE_DEMO === '1' ? undefined : '_blank'} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 font-semibold hover:bg-slate-50">
                <ExternalLink className="size-5" aria-hidden /> Open
              </Link>
            </div>
          </Card>
        )
      )}

      <div className="mb-4 overflow-x-auto">
        <div className="w-max">
          <Segmented
            label="Show"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'waiting', label: `Waiting (${groups.waiting.length})` },
              { value: 'upcoming', label: `Upcoming (${groups.upcoming.length})` },
              { value: 'past', label: 'Past' },
              { value: 'closed', label: 'Declined or cancelled' },
            ]}
          />
        </div>
      </div>

      {bookings.isLoading && <Spinner />}
      {bookings.data && rows.length === 0 && (
        <EmptyState title={tab === 'waiting' ? 'No requests waiting' : 'Nothing here'}>
          {tab === 'waiting' ? 'New requests from your booking page show up here right away.' : null}
        </EmptyState>
      )}
      {rows.length > 0 && (
        <ResponsiveList
          rows={rows}
          rowKey={(b) => b.id}
          title={(b) => b.event_name || b.organization || b.client_name}
          subtitle={(b) => `${whenText(b)} · ${b.place}`}
          badge={(b) => <Badge tone={tones[b.status]}>{statusLabels[b.status]}</Badge>}
          onSelect={(b) => setOpen(b.id)}
          actionLabel="Open"
          columns={[
            { label: 'When', cell: (b) => <span className="font-medium">{whenText(b)}</span> },
            { label: 'Event', cell: (b) => b.event_name || b.organization || '' },
            { label: 'Client', cell: (b) => b.client_name },
            { label: 'Where', cell: (b) => <span className="line-clamp-2">{b.place}</span> },
            { label: 'Truck', cell: (b) => truckName(b.truck_id) },
            { label: 'Status', cell: (b) => <Badge tone={tones[b.status]}>{statusLabels[b.status]}</Badge> },
          ]}
        />
      )}

      {open && (
        <BookingSheet
          key={open.id + open.status}
          booking={open}
          supplies={(bookings.data?.supplies ?? []).filter((l) => l.booking_id === open.id)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
