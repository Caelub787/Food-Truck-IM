import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSignalBatcher, refreshTables } from './live'

afterEach(() => vi.useRealTimers())

describe('createSignalBatcher', () => {
  it('turns a burst of signals into one reload', () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const batcher = createSignalBatcher(flush, 100)
    batcher.push('profiles')
    batcher.push('profiles')
    batcher.push('companies')
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(flush).toHaveBeenCalledTimes(1)
    expect([...flush.mock.calls[0]![0]]).toEqual(['profiles', 'companies'])
  })
})

describe('refreshTables', () => {
  it('only reloads queries that read the changed table', async () => {
    const client = new QueryClient()
    const people = vi.fn(async () => 'people')
    const trucks = vi.fn(async () => 'trucks')
    await client.fetchQuery({ queryKey: ['people'], queryFn: people, meta: { tables: ['profiles'] } })
    await client.fetchQuery({ queryKey: ['trucks'], queryFn: trucks, meta: { tables: ['trucks'] } })
    await refreshTables(client, ['profiles'])
    expect(client.getQueryState(['people'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['trucks'])?.isInvalidated).toBe(false)
  })
})
