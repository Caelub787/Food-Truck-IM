import { useQuery, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

// Live updates: the database sends "this table changed" signals, and every
// query that reads that table loads again on its own. Every query that shows
// data must use useLiveQuery and list the tables it reads.

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: { tables?: string[] }
  }
}

export type LiveStatus = 'connecting' | 'live' | 'offline'

let status: LiveStatus = 'connecting'
const listeners = new Set<() => void>()

export function setLiveStatus(next: LiveStatus) {
  if (next === status) return
  status = next
  listeners.forEach((listener) => listener())
}

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
  )
}

/** While the live connection is down, screens check for changes this often instead. */
export const FALLBACK_POLL_MS = 15_000

/** A query that reloads by itself whenever one of its tables changes. */
export function useLiveQuery<T>(options: {
  tables: string[]
  queryKey: QueryKey
  queryFn: () => Promise<T>
  enabled?: boolean
  staleTime?: number
}) {
  const live = useLiveStatus()
  return useQuery({
    queryKey: options.queryKey,
    queryFn: options.queryFn,
    enabled: options.enabled,
    // While live, data stays fresh until a signal says otherwise.
    staleTime: options.staleTime ?? (live === 'live' ? 60_000 : 0),
    meta: { tables: options.tables },
    refetchInterval: live === 'live' ? false : FALLBACK_POLL_MS,
  })
}

/** Reloads every query that reads any of these tables. */
export function refreshTables(queryClient: QueryClient, tables: Iterable<string>) {
  const changed = new Set(tables)
  return queryClient.invalidateQueries({
    predicate: (query) => (query.meta?.tables ?? []).some((table) => changed.has(table)),
  })
}

/** Reloads every live query (after a reconnect, when signals may have been missed). */
export function refreshAllLive(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ predicate: (query) => Boolean(query.meta?.tables?.length) })
}

/**
 * Collects signals for a moment before reloading, so a burst of changes
 * (like a big import) causes one reload instead of many.
 */
export function createSignalBatcher(onFlush: (tables: Set<string>) => void, waitMs = 150) {
  let pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    push(table: string) {
      pending.add(table)
      timer ??= setTimeout(() => {
        const tables = pending
        pending = new Set()
        timer = null
        onFlush(tables)
      }, waitMs)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = new Set()
    },
  }
}
