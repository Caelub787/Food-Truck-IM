import type { QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { friendlyError } from './errors'
import { refreshTables } from './live'
import { supabase } from './supabase'

// Things done with weak or no signal wait on the phone and go out when the
// connection comes back, in the order they were done. Every queued call carries
// its own client id or time, so sending it twice never does the work twice.

export type Job = {
  id: string
  fn: string
  args: Record<string, unknown>
  /** Tables to reload once it's sent. */
  tables: string[]
  /** Short words for the person, like "Waste: Cups". */
  label: string
  /** A photo to upload first (shrunk, as a data URL). */
  upload?: { path: string; dataUrl: string }
  addedAt: number
}

type State = { jobs: Job[]; failed: { label: string; message: string }[]; sending: boolean }

const KEY = 'waiting-to-send-v1'
let state: State = { jobs: read(), failed: [], sending: false }
const listeners = new Set<() => void>()
let client: QueryClient | null = null

function read(): Job[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Job[]) : []
  } catch {
    return []
  }
}

function set(next: Partial<State>) {
  state = { ...state, ...next }
  try {
    localStorage.setItem(KEY, JSON.stringify(state.jobs))
  } catch {
    // Storage full or blocked: the queue still works until the app closes.
  }
  listeners.forEach((l) => l())
}

/** True when the call never reached the server (no signal), so it's safe to try again later. */
export function isNetworkError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out/i.test(message)
}

async function run(job: Job) {
  if (job.upload) {
    const blob = await (await fetch(job.upload.dataUrl)).blob()
    const { error } = await supabase.storage.from('photos').upload(job.upload.path, blob, { upsert: true, contentType: blob.type })
    if (error) throw error
  }
  const { error } = await supabase.rpc(job.fn, job.args)
  if (error) throw new Error(error.message)
}

/**
 * Sends a database call now, or keeps it to send later if there's no signal.
 * Throws for real problems (like "Only the Lead can do this").
 */
export async function sendOrQueue(input: Omit<Job, 'id' | 'addedAt'>): Promise<'sent' | 'queued'> {
  const job: Job = { ...input, id: crypto.randomUUID(), addedAt: Date.now() }
  // Keep the order: if older things are still waiting, this waits behind them.
  if (state.jobs.length > 0) {
    set({ jobs: [...state.jobs, job] })
    void flushQueue()
    return 'queued'
  }
  try {
    await run(job)
  } catch (error) {
    if (!isNetworkError(error)) throw error
    set({ jobs: [...state.jobs, job] })
    return 'queued'
  }
  if (client) void refreshTables(client, job.tables)
  return 'sent'
}

/** Sends everything that's waiting, oldest first. Stops at the first sign of no signal. */
export async function flushQueue() {
  if (state.sending || state.jobs.length === 0) return
  set({ sending: true })
  try {
    while (state.jobs.length > 0) {
      const job = state.jobs[0]!
      try {
        await run(job)
      } catch (error) {
        if (isNetworkError(error)) break
        // The server said no (like the shift was already finished). Drop it and tell the person.
        set({ failed: [...state.failed, { label: job.label, message: friendlyError(error) }] })
      }
      set({ jobs: state.jobs.filter((j) => j.id !== job.id) })
      if (client) void refreshTables(client, job.tables)
    }
  } finally {
    set({ sending: false })
  }
}

export function clearFailed() {
  set({ failed: [] })
}

/** Starts sending waiting things whenever the phone gets signal back. Call once. */
export function startQueue(queryClient: QueryClient) {
  client = queryClient
  window.addEventListener('online', () => void flushQueue())
  setInterval(() => void flushQueue(), 15_000)
  void flushQueue()
}

export function useQueue() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

/** For tests. */
export function resetQueue() {
  state = { jobs: [], failed: [], sending: false }
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
