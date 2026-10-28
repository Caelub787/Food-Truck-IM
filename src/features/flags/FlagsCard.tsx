import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { Link } from 'react-router'
import { Button, Card, Notice } from '@/components/ui'
import { refreshTables } from '@/lib/live'
import { rpc } from '@/lib/supabase'
import { useAction } from '@/lib/useAction'
import { useOpenFlags } from './data'

/** Things the app noticed that a manager should look at. */
export function FlagsCard() {
  const flags = useOpenFlags(6)
  const queryClient = useQueryClient()
  const review = useAction(async (id: string) => {
    await rpc('review_flag', { p_flag_id: id, p_note: null })
    await refreshTables(queryClient, ['flags'])
  })
  if (!flags.data || flags.data.length === 0) return null

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-amber-600" aria-hidden />
          <h2 className="font-semibold">Needs a look</h2>
        </div>
        <Link to="/flags" className="text-sm font-medium text-brand-700">
          See all
        </Link>
      </div>
      <ul className="mt-2 divide-y divide-slate-100">
        {flags.data.map((f) => (
          <li key={f.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">{f.title}</p>
              {f.details && <p className="text-sm text-slate-600">{f.details}</p>}
              <p className="text-sm text-slate-500">
                {new Date(f.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {f.shift_id && (
                  <>
                    {' · '}
                    <Link to={`/shifts/${f.shift_id}`} className="font-medium text-brand-700">
                      Open shift
                    </Link>
                  </>
                )}
              </p>
            </div>
            <Button variant="secondary" className="shrink-0" onClick={() => void review.run(f.id)} disabled={review.busy}>
              Looks fine
            </Button>
          </li>
        ))}
      </ul>
      {review.error && <Notice tone="error">{review.error}</Notice>}
    </Card>
  )
}
