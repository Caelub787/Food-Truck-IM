import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args), storage: { from: vi.fn() } } }))

const { flushQueue, isNetworkError, resetQueue, sendOrQueue } = await import('./offline')

const job = (label: string) => ({ fn: 'save_shift_counts', args: { p: { label } }, tables: ['shift_counts'], label })
const offline = () => Promise.resolve({ error: { message: 'TypeError: Failed to fetch' } })
const ok = () => Promise.resolve({ error: null })

beforeEach(() => {
  resetQueue()
  rpc.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('sending with weak signal', () => {
  it('sends right away when there is signal', async () => {
    rpc.mockImplementation(ok)
    await expect(sendOrQueue(job('a'))).resolves.toBe('sent')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('keeps things that fail for no signal, then sends them in order', async () => {
    rpc.mockImplementationOnce(offline)
    await expect(sendOrQueue(job('a'))).resolves.toBe('queued')
    // Still no signal, so the next one waits behind the first.
    rpc.mockImplementationOnce(offline)
    await expect(sendOrQueue(job('b'))).resolves.toBe('queued')
    await new Promise((r) => setTimeout(r, 0))

    rpc.mockReset()
    rpc.mockImplementation(ok)
    await flushQueue()
    expect(rpc.mock.calls.map((c) => (c[1] as { p: { label: string } }).p.label)).toEqual(['a', 'b'])
    expect(localStorage.getItem('waiting-to-send-v1')).toBe('[]')
  })

  it('real errors are thrown, not kept', async () => {
    rpc.mockImplementation(() => Promise.resolve({ error: { message: 'Only the Lead can do this.' } }))
    await expect(sendOrQueue(job('a'))).rejects.toThrow('Only the Lead')
    expect(localStorage.getItem('waiting-to-send-v1')).toBeNull()
  })

  it('tells network trouble apart from other errors', () => {
    expect(isNetworkError(new Error('TypeError: Failed to fetch'))).toBe(true)
    expect(isNetworkError(new Error('Load failed'))).toBe(true)
    expect(isNetworkError(new Error('That shift was not found.'))).toBe(false)
  })
})
