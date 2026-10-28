import { describe, expect, it } from 'vitest'
import { periodRange } from './data'

describe('report periods', () => {
  const now = new Date(2026, 9, 28, 15, 30) // Oct 28, 2026, 3:30 PM
  it('covers whole days up to the end of today', () => {
    const [from, to] = periodRange('week', now)
    expect(from).toEqual(new Date(2026, 9, 22))
    expect(to).toEqual(new Date(2026, 9, 29))
  })
  it('knows calendar months', () => {
    expect(periodRange('this_month', now)).toEqual([new Date(2026, 9, 1), new Date(2026, 9, 29)])
    expect(periodRange('last_month', now)).toEqual([new Date(2026, 8, 1), new Date(2026, 9, 1)])
  })
})
