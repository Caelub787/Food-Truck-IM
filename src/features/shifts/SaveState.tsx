import type { SaveStatus } from './useCountDraft'

/** A small line saying whether counts are saved, saving, or waiting for signal. */
export function SaveState({ status, error }: { status: SaveStatus; error: string | null }) {
  if (status === 'idle') return null
  const text = {
    saving: 'Saving…',
    saved: 'Saved',
    queued: "No signal. Saved on this phone and it'll send when you're back online.",
    error: error ?? "Couldn't save.",
  }[status]
  return (
    <span role="status" className={`text-sm ${status === 'error' ? 'text-red-600' : status === 'queued' ? 'text-amber-700' : 'text-slate-500'}`}>
      {text}
    </span>
  )
}
