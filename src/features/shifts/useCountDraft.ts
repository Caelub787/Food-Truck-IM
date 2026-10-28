import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyError } from '@/lib/errors'
import { sendOrQueue } from '@/lib/offline'
import type { ShiftCount } from './data'

type Line = { supply_id: string; quantity: number | null; client_ts: string }
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'queued' | 'error'

const COUNT_TABLES = ['shift_counts']

/**
 * Counts typed on this phone, saved a moment after typing stops. If someone
 * else changes the same line later, their change shows instead (latest wins,
 * same as the server). Amounts are in base units.
 */
export function useCountDraft(shiftId: string, kind: 'start' | 'end', saved: ShiftCount[] | undefined) {
  const [local, setLocal] = useState<Record<string, { base: number | null; at: string }>>({})
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(new Map<string, Line>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (pending.current.size === 0) return
    const lines = [...pending.current.values()]
    pending.current.clear()
    setStatus('saving')
    try {
      const result = await sendOrQueue({
        fn: 'save_shift_counts',
        args: { p: { shift_id: shiftId, kind, lines } },
        tables: COUNT_TABLES,
        label: kind === 'start' ? 'Starting count' : 'Ending count',
      })
      setStatus(result === 'sent' ? 'saved' : 'queued')
      setError(null)
    } catch (e) {
      setStatus('error')
      setError(friendlyError(e))
    }
  }, [shiftId, kind])

  // Don't lose anything typed if the screen closes.
  useEffect(() => () => void flush(), [flush])

  const set = (supplyId: string, base: number | null) => {
    const at = new Date().toISOString()
    setLocal((prev) => ({ ...prev, [supplyId]: { base, at } }))
    pending.current.set(supplyId, { supply_id: supplyId, quantity: base, client_ts: at })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 700)
  }

  /** The count to show: undefined means nobody has counted it yet. */
  const value = (supplyId: string): number | null | undefined => {
    const mine = local[supplyId]
    const theirs = saved?.find((c) => c.supply_id === supplyId && c.kind === kind)
    if (mine && (!theirs || Date.parse(mine.at) >= Date.parse(theirs.client_ts))) return mine.base ?? undefined
    if (theirs) return Number(theirs.quantity)
    return undefined
  }

  return { value, set, flush, status, error }
}
