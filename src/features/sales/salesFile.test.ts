import { describe, expect, it } from 'vitest'
import { buildRows, guessColumns, itemKey, parseMoney, parseWhen, splitModifiers } from './salesFile'

const squareHeaders = [
  'Date', 'Time', 'Time Zone', 'Category', 'Item', 'Qty', 'Price Point Name', 'SKU', 'Modifiers Applied',
  'Gross Sales', 'Discounts', 'Net Sales', 'Tax', 'Transaction ID', 'Payment ID', 'Device Name', 'Notes',
  'Details', 'Event Type', 'Location',
]

describe('guessing columns', () => {
  it('knows a Square item sales export', () => {
    expect(guessColumns(squareHeaders)).toEqual({
      date: 0, time: 1, item: 4, quantity: 5, size: 6, modifiers: 8, price: 11, order: 13, event: 18, truck: 19,
    })
  })

  it('works with simple files too', () => {
    expect(guessColumns(['Sale date', 'Product', 'Quantity', 'Total'])).toEqual({ date: 0, item: 1, quantity: 2, price: 3 })
  })
})

describe('reading cells', () => {
  it('reads money', () => {
    expect(parseMoney('$1,234.50')).toBe(1234.5)
    expect(parseMoney('(4.00)')).toBe(-4)
    expect(parseMoney('')).toBeNull()
  })

  it('reads dates and times in common formats', () => {
    expect(parseWhen('2026-10-28', '14:05:33')).toEqual({ local: '2026-10-28 14:05:33' })
    expect(parseWhen('10/28/2026', '2:05 PM')).toEqual({ local: '2026-10-28 14:05:00' })
    expect(parseWhen('10/28/26 12:15 am')).toEqual({ local: '2026-10-28 00:15:00' })
    expect(parseWhen('2026-10-28T19:05:00Z')).toEqual({ at: '2026-10-28T19:05:00.000Z' })
    expect(parseWhen('yesterday')).toBeNull()
    expect(parseWhen('13/45/2026')).toBeNull()
  })

  it('splits add ons and makes item keys', () => {
    expect(splitModifiers('Oat Milk, Extra Shot; Vanilla')).toEqual(['Oat Milk', 'Extra Shot', 'Vanilla'])
    expect(itemKey('Latte ', 'Large')).toBe('latte · large')
    expect(itemKey('Hot Dog', 'Regular')).toBe('hot dog')
  })
})

describe('building sales from a file', () => {
  const cols = guessColumns(squareHeaders)
  const row = (o: Partial<Record<string, string>>) =>
    squareHeaders.map((h) => o[h] ?? { Date: '2026-10-28', Time: '13:00:00', Item: 'Latte', Qty: '1', 'Net Sales': '$5.00', 'Event Type': 'Payment' }[h] ?? '')

  it('gives the same ids every time, so uploads never double count', () => {
    const rows = [row({ 'Transaction ID': 'T1' }), row({ 'Transaction ID': 'T1' }), row({ 'Transaction ID': 'T2', 'Price Point Name': 'Large' })]
    const a = buildRows(rows, cols)
    const b = buildRows(rows, cols)
    expect(a.rows.map((r) => r.ref)).toEqual(['T1:latte:#1', 'T1:latte:#2', 'T2:latte · large:#1'])
    expect(b.rows.map((r) => r.ref)).toEqual(a.rows.map((r) => r.ref))
  })

  it('skips refunds and rows with no item or date, and $0 sales are free', () => {
    const { rows, skipped } = buildRows(
      [
        row({ 'Event Type': 'Refund' }),
        row({ Item: '' }),
        row({ Date: '' }),
        row({ 'Net Sales': '$0.00', 'Modifiers Applied': 'Oat Milk' }),
      ],
      cols,
    )
    expect(skipped.map((s) => s.why)).toEqual(['refund', 'no item', 'no date'])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ is_free: true, price: 0, modifier_keys: ['oat milk'], sold_local: '2026-10-28 13:00:00' })
  })
})
