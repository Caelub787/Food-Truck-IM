import { FALLBACK_POLL_MS, useLiveStatus } from '@/lib/live'

const looks = {
  live: { dot: 'bg-emerald-500', label: 'Live', title: 'Changes from your team show up right away.' },
  connecting: { dot: 'bg-slate-300 animate-pulse', label: 'Connecting', title: 'Connecting for live updates.' },
  offline: {
    dot: 'bg-amber-500',
    label: 'Reconnecting',
    title: `Live updates are paused. Checking for changes every ${FALLBACK_POLL_MS / 1000} seconds until the connection is back.`,
  },
}

/** A small light showing whether changes from others are coming in live. */
export function LiveBadge() {
  const look = looks[useLiveStatus()]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500" title={look.title} role="status">
      <span className={`size-2 rounded-full ${look.dot}`} aria-hidden />
      {look.label}
    </span>
  )
}
