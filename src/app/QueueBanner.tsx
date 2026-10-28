import { CloudOff } from 'lucide-react'
import { clearFailed, flushQueue, useQueue } from '@/lib/offline'

/** Tells people when things they did are waiting for signal, or couldn't be saved. */
export function QueueBanner() {
  const q = useQueue()
  if (q.jobs.length === 0 && q.failed.length === 0) return null
  return (
    <div className="mb-4 space-y-2">
      {q.jobs.length > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <CloudOff className="size-5 shrink-0" aria-hidden />
          <span className="flex-1">
            <strong>
              {q.jobs.length} change{q.jobs.length === 1 ? '' : 's'} waiting for signal.
            </strong>{' '}
            They're saved on this phone and will send by themselves.
          </span>
          <button onClick={() => void flushQueue()} disabled={q.sending} className="min-h-10 rounded-lg px-3 font-semibold underline">
            {q.sending ? 'Sending…' : 'Try now'}
          </button>
        </div>
      )}
      {q.failed.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">Some changes made with no signal couldn't be saved:</p>
          <ul className="mt-1 list-disc pl-5">
            {q.failed.map((f, i) => (
              <li key={i}>
                {f.label}: {f.message}
              </li>
            ))}
          </ul>
          <button onClick={clearFailed} className="mt-2 min-h-10 font-semibold underline">
            Got it
          </button>
        </div>
      )}
    </div>
  )
}
