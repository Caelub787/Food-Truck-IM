import { useCallback, useEffect, useRef, useState } from 'react'
import type { SaveStatus } from '@/features/shifts/useCountDraft'
import { friendlyError } from '@/lib/errors'
import { sendOrQueue } from '@/lib/offline'
import type { Sale } from './data'

export type TallyLine = {
  key: string
  product_size_id: string
  modifier_ids: string[]
  is_free: boolean
  free_reason_id: string | null
}

/** A short, steady key for a kind of drink: size, add ons, and paid or free. */
export function tallyKey(line: Omit<TallyLine, 'key'>) {
  if (line.modifier_ids.length === 0 && !line.is_free) return `p:${line.product_size_id}`
  const text = [[...line.modifier_ids].sort().join('.'), line.is_free ? 'f' : 'p', line.free_reason_id ?? ''].join(':')
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0
  return `x:${line.product_size_id}:${hash.toString(36)}`
}

/**
 * Drink counts typed on this phone for one shift, saved a moment after typing
 * stops (or kept on the phone with no signal). Latest change wins, like counts.
 */
export function useTallyDraft(shiftId: string, saved: Sale[]) {
  const [local, setLocal] = useState<Record<string, { line: TallyLine; quantity: number; at: string }>>({})
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(new Map<string, TallyLine & { quantity: number; client_ts: string }>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefix = `${shiftId}:`

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (pending.current.size === 0) return
    const lines = [...pending.current.values()]
    pending.current.clear()
    setStatus('saving')
    try {
      const result = await sendOrQueue({ fn: 'save_sales_tally', args: { p: { shift_id: shiftId, lines } }, tables: ['sales'], label: 'Drink counts' })
      setStatus(result === 'sent' ? 'saved' : 'queued')
      setError(null)
    } catch (e) {
      setStatus('error')
      setError(friendlyError(e))
    }
  }, [shiftId])

  useEffect(() => () => void flush(), [flush])

  const savedLines = new Map<string, { line: TallyLine; quantity: number; at: string }>()
  for (const s of saved) {
    const key = s.source_ref.startsWith(prefix) ? s.source_ref.slice(prefix.length) : s.source_ref
    savedLines.set(key, {
      line: { key, product_size_id: s.product_size_id, modifier_ids: s.modifier_ids ?? [], is_free: s.is_free, free_reason_id: s.free_reason_id },
      quantity: Number(s.quantity),
      at: s.client_ts,
    })
  }

  /** Every line with its current count, newest change winning. */
  const lines = () => {
    const keys = new Set([...savedLines.keys(), ...Object.keys(local)])
    return [...keys].map((key) => {
      const mine = local[key]
      const theirs = savedLines.get(key)
      const pick = mine && (!theirs || Date.parse(mine.at) >= Date.parse(theirs.at)) ? mine : (theirs ?? mine)!
      return { ...pick.line, quantity: pick.quantity }
    })
  }

  const set = (line: TallyLine, quantity: number) => {
    const at = new Date().toISOString()
    setLocal((prev) => ({ ...prev, [line.key]: { line, quantity, at } }))
    pending.current.set(line.key, { ...line, quantity, client_ts: at })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 700)
  }

  const quantity = (key: string) => lines().find((l) => l.key === key)?.quantity ?? 0

  return { lines, set, quantity, flush, status, error }
}
