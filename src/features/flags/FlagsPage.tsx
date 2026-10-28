import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { EmptyState, Segmented } from '@/components/forms'
import { Badge, Button, Card, Field, Notice, PageHeader, Spinner } from '@/components/ui'
import { usePeopleNames } from '@/features/inventory/data'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { useFlags, type FlagRow } from './data'

const kindLabels: Record<string, string> = {
  usage_diff: 'Usage vs sales',
  shift_cost: 'Shift cost',
  sales_mismatch: 'Sales mismatch',
  start_mismatch: 'Starting count',
  count_check: 'Count check',
  count_check_missed: 'Count check',
  count_check_waiting: 'Count check',
  low_stock: 'Low stock',
  expiring: 'Expiring',
  expired: 'Expired',
  open_too_long: 'Open shift',
  not_started: 'Schedule',
  waste_pattern: 'Waste',
  repeat_diff: 'Pattern',
  sales_no_shift: 'Sales',
}

/** Everything the app noticed that a manager should look at, with notes. */
export function FlagsPage() {
  const [tab, setTab] = useState<'open' | 'reviewed'>('open')
  const flags = useFlags(tab)
  return (
    <div>
      <PageHeader title="Needs a look" subtitle="Things the app noticed. Mark them looked at, with a note if it helps the next person." />
      <div className="mb-4">
        <Segmented
          label="Which flags"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'reviewed', label: 'Looked at' },
          ]}
        />
      </div>
      {!flags.data ? (
        <Spinner />
      ) : flags.data.length === 0 ? (
        <EmptyState title={tab === 'open' ? 'All clear' : 'Nothing looked at yet'} />
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {flags.data.map((f) => (
            <FlagCard key={f.id} flag={f} />
          ))}
        </div>
      )}
    </div>
  )
}

function FlagCard({ flag: f }: { flag: FlagRow }) {
  const queryClient = useQueryClient()
  const who = usePeopleNames()
  const [note, setNote] = useState('')
  const [writing, setWriting] = useState(false)
  const review = useAction(async () => {
    await rpc('review_flag', { p_flag_id: f.id, p_note: note || null })
    await refreshTables(queryClient, ['flags'])
  })
  const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{f.title}</p>
        <Badge tone={f.severity === 'alert' ? 'red' : f.severity === 'info' ? 'blue' : 'amber'}>{kindLabels[f.kind] ?? 'Flag'}</Badge>
      </div>
      {f.details && <p className="mt-1 text-slate-600">{f.details}</p>}
      <p className="mt-1 text-sm text-slate-500">
        {when(f.created_at)}
        {f.shift_id && (
          <>
            {' · '}
            <Link to={`/shifts/${f.shift_id}`} className="font-medium text-brand-700">
              Open shift
            </Link>
          </>
        )}
      </p>
      {f.status === 'reviewed' ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Looked at by {who(f.reviewed_by) || 'someone'} {f.reviewed_at && when(f.reviewed_at)}
          {f.review_note && `: ${f.review_note}`}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {writing && <Field label="Note (optional)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}
          {review.error && <Notice tone="error">{review.error}</Notice>}
          <div className="flex gap-2">
            <Button variant="secondary" busy={review.busy} onClick={() => void review.run()} className="flex-1">
              Looks fine
            </Button>
            {!writing && (
              <Button variant="ghost" onClick={() => setWriting(true)}>
                Add a note
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
