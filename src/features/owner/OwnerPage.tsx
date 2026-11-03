import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge, Button, Card, Notice, PageHeader, Sheet, Spinner } from '@/components/ui'
import type { CompanyStatus } from '@/lib/config'
import { useLiveQuery } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { PushKeysCard } from './PushKeysCard'

type OwnerCompany = {
  id: string
  name: string
  status: CompanyStatus
  created_at: string
  status_changed_at: string | null
  status_reason: string | null
  phone: string | null
  truck_count_estimate: number | null
  signup_note: string | null
  timezone: string
  admin_name: string | null
  admin_email: string | null
  member_count: number
  last_active_at: string | null
}

type OwnerStats = { database_bytes: number; database_limit_bytes: number; companies: Partial<Record<CompanyStatus, number>>; people: number }

const shortStatus: Record<CompanyStatus, string> = { pending: 'Waiting', active: 'Active', declined: 'Declined', suspended: 'Paused' }

const statusTone: Record<CompanyStatus, 'amber' | 'green' | 'red' | 'gray'> = {
  pending: 'amber',
  active: 'green',
  declined: 'red',
  suspended: 'gray',
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'never'
}

export function OwnerPage() {
  const [tab, setTab] = useState<'waiting' | 'all'>('waiting')
  const companies = useLiveQuery({
    tables: ['companies', 'profiles'],
    queryKey: ['owner', 'companies'],
    queryFn: () => rpc<OwnerCompany[]>('owner_list_companies'),
  })
  const stats = useLiveQuery({
    tables: ['companies', 'profiles'],
    queryKey: ['owner', 'stats'],
    queryFn: () => rpc<OwnerStats>('owner_stats'),
  })
  const waiting = (companies.data ?? []).filter((c) => c.status === 'pending')
  const list = tab === 'waiting' ? waiting : (companies.data ?? [])

  return (
    <div>
      <PageHeader title="App owner" subtitle="Approve new businesses and keep an eye on the app." />
      {stats.data && (
        <div className="lg:max-w-2xl">
          <StatsCard stats={stats.data} />
        </div>
      )}

      <div className="mt-6 mb-3 flex gap-2" role="tablist">
        {(
          [
            ['waiting', `Waiting (${waiting.length})`],
            ['all', `All businesses (${companies.data?.length ?? 0})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-11 rounded-full px-4 font-medium ${tab === key ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {companies.isLoading && <Spinner />}
      {companies.error && <Notice tone="error">{companies.error.message}</Notice>}
      {!companies.isLoading && list.length === 0 && (
        <Card className="text-center text-slate-500">{tab === 'waiting' ? 'No sign ups are waiting.' : 'No businesses yet.'}</Card>
      )}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {list.map((company) => (
          <CompanyCard key={company.id} company={company} />
        ))}
      </div>
      <div className="mt-8 lg:max-w-2xl">
        <PushKeysCard />
      </div>
    </div>
  )
}

function StatsCard({ stats }: { stats: OwnerStats }) {
  const usedMb = stats.database_bytes / 1024 / 1024
  const limitMb = stats.database_limit_bytes / 1024 / 1024
  const percent = Math.min(100, (usedMb / limitMb) * 100)
  return (
    <Card>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-2xl font-bold">{stats.companies.active ?? 0}</p>
          <p className="text-sm text-slate-500">Active</p>
        </div>
        <div>
          <p className="text-2xl font-bold">{stats.companies.pending ?? 0}</p>
          <p className="text-sm text-slate-500">Waiting</p>
        </div>
        <div>
          <p className="text-2xl font-bold">{stats.people}</p>
          <p className="text-sm text-slate-500">People</p>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex justify-between text-sm text-slate-600">
          <span>Database space (free plan)</span>
          <span>
            {usedMb.toFixed(0)} MB of {limitMb.toFixed(0)} MB
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full ${percent > 80 ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${percent}%` }} />
        </div>
      </div>
    </Card>
  )
}

function CompanyCard({ company }: { company: OwnerCompany }) {
  const queryClient = useQueryClient()
  const [reasonFor, setReasonFor] = useState<CompanyStatus | null>(null)
  const [reason, setReason] = useState('')

  const setStatus = useAction(async (status: CompanyStatus, note?: string) => {
    await rpc('owner_set_company_status', { p_company_id: company.id, p_status: status, p_reason: note || null })
    setReasonFor(null)
    setReason('')
    await queryClient.invalidateQueries({ queryKey: ['owner'] })
  })

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{company.name}</h3>
          <p className="truncate text-sm text-slate-600">
            {company.admin_name} · {company.admin_email}
          </p>
        </div>
        <Badge tone={statusTone[company.status]}>{shortStatus[company.status]}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
        <dt>Signed up</dt>
        <dd>{formatDate(company.created_at)}</dd>
        <dt>Phone</dt>
        <dd>{company.phone ?? 'not given'}</dd>
        <dt>Trucks</dt>
        <dd>{company.truck_count_estimate ?? 'not given'}</dd>
        <dt>People</dt>
        <dd>{company.member_count}</dd>
        <dt>Last active</dt>
        <dd>{formatDate(company.last_active_at)}</dd>
      </dl>
      {company.signup_note && <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm">Their note: {company.signup_note}</p>}
      {company.status_reason && company.status !== 'pending' && (
        <p className="mt-2 text-sm text-slate-500">Your note: {company.status_reason}</p>
      )}
      {setStatus.error && (
        <div className="mt-3">
          <Notice tone="error">{setStatus.error}</Notice>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {company.status === 'pending' && (
          <>
            <Button busy={setStatus.busy} onClick={() => void setStatus.run('active')}>
              Approve
            </Button>
            <Button variant="secondary" onClick={() => setReasonFor('declined')}>
              Decline
            </Button>
          </>
        )}
        {company.status === 'active' && (
          <Button variant="secondary" onClick={() => setReasonFor('suspended')}>
            Pause business
          </Button>
        )}
        {(company.status === 'suspended' || company.status === 'declined') && (
          <Button variant="secondary" busy={setStatus.busy} onClick={() => void setStatus.run('active')}>
            {company.status === 'suspended' ? 'Turn back on' : 'Approve after all'}
          </Button>
        )}
      </div>

      <Sheet
        title={reasonFor === 'declined' ? `Decline ${company.name}?` : `Pause ${company.name}?`}
        open={reasonFor !== null}
        onClose={() => setReasonFor(null)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-slate-600">
            {reasonFor === 'declined'
              ? "They'll get an email saying they weren't approved."
              : "Nobody in this business will be able to log in until you turn it back on. Their data is kept."}
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">Note for them (optional)</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="rounded-xl border border-slate-300 p-3 outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <Button variant="danger" busy={setStatus.busy} onClick={() => reasonFor && void setStatus.run(reasonFor, reason)}>
            {reasonFor === 'declined' ? 'Decline' : 'Pause business'}
          </Button>
        </div>
      </Sheet>
    </Card>
  )
}
