import { describe, expect, it } from 'vitest'
import { busyCount, dayStatus, endTimes, localBusy, localStamp, monthGrid, startTimes, steps, timeLabel, type BookingRules } from './slots'

const rules = (extra: Partial<BookingRules> = {}): BookingRules => ({
  timezone: 'America/Chicago',
  days: [5, 6],
  open: '10:00',
  close: '14:00',
  first_day: '2026-05-01',
  last_day: '2026-06-30',
  capacity: 1,
  // Saturday May 9, 11:00 AM to 1:00 PM in Chicago.
  busy: [{ starts_at: '2026-05-09T16:00:00Z', ends_at: '2026-05-09T18:00:00Z' }],
  ...extra,
})

describe('booking page times', () => {
  it('reads times in the business time zone', () => {
    expect(localStamp('2026-05-09T16:00:00Z', 'America/Chicago')).toBe('2026-05-09T11:00')
    expect(localStamp('2026-05-10T03:30:00Z', 'America/Los_Angeles')).toBe('2026-05-09T20:30')
    expect(steps('10:00', '11:30')).toEqual(['10:00', '10:30', '11:00', '11:30'])
    expect(timeLabel('13:30')).toBe('1:30 PM')
    expect(timeLabel('00:00')).toBe('12:00 AM')
  })

  it('knows which days can be picked', () => {
    const r = rules()
    const busy = localBusy(r)
    expect(dayStatus(r, busy, '2026-04-30')).toBe('out')
    expect(dayStatus(r, busy, '2026-05-07')).toBe('closed')
    expect(dayStatus(r, busy, '2026-05-09')).toBe('open')
    const allDay = rules({ busy: [{ starts_at: '2026-05-09T15:00:00Z', ends_at: '2026-05-09T19:00:00Z' }] })
    expect(dayStatus(allDay, localBusy(allDay), '2026-05-09')).toBe('full')
    const twoTrucks = { ...allDay, capacity: 2 }
    expect(dayStatus(twoTrucks, localBusy(twoTrucks), '2026-05-09')).toBe('open')
  })

  it('offers start and end times around busy ones', () => {
    const r = rules()
    const busy = localBusy(r)
    expect(busyCount(busy, '2026-05-09', '10:00', '11:00')).toBe(0)
    expect(busyCount(busy, '2026-05-09', '10:30', '11:30')).toBe(1)
    expect(startTimes(r, busy, '2026-05-09').filter((t) => t.free).map((t) => t.time)).toEqual(['10:00', '10:30', '13:00', '13:30'])
    expect(endTimes(r, busy, '2026-05-09', '10:00')).toEqual(['10:30', '11:00'])
    expect(endTimes(r, busy, '2026-05-09', '13:00')).toEqual(['13:30', '14:00'])
  })

  it('lays out a month starting on Sunday', () => {
    const may = monthGrid(2026, 4)
    expect(may.slice(0, 6)).toEqual([null, null, null, null, null, '2026-05-01'])
    expect(may.at(-1)).toBe('2026-05-31')
  })
})
