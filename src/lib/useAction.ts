import { useCallback, useState } from 'react'
import { friendlyError } from './errors'

/** Runs an async action and tracks whether it's busy and any friendly error message. */
export function useAction<Args extends unknown[]>(action: (...args: Args) => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (...args: Args) => {
      setBusy(true)
      setError(null)
      try {
        await action(...args)
      } catch (e) {
        setError(friendlyError(e))
      } finally {
        setBusy(false)
      }
    },
    [action],
  )

  return { run, busy, error, setError }
}
