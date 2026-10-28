import { describe, expect, it } from 'vitest'
import { clean, describeAmount, formatAmount, formatMoney, fromBase, toBase, unitLabel, unitsFor } from './units'

const milk = { id: 'milk', base_unit: 'oz', count_unit_id: 'hg', purchase_unit_id: 'case' }
const rows = [
  { id: 'case', supply_id: 'milk', name: 'case', factor: '384' },
  { id: 'hg', supply_id: 'milk', name: 'half gallon', factor: '64' },
  { id: 'other', supply_id: 'cups', name: 'sleeve', factor: '50' },
]

describe('units', () => {
  it('lists the base unit first, then the rest smallest to biggest', () => {
    expect(unitsFor(milk, rows).map((u) => u.name)).toEqual(['oz', 'half gallon', 'case'])
  })

  it('converts both ways', () => {
    const [, halfGallon] = unitsFor(milk, rows)
    expect(toBase(6.5, halfGallon!)).toBe(416)
    expect(fromBase(416, halfGallon!)).toBe(6.5)
    expect(clean(0.1 + 0.2)).toBe(0.3)
  })

  it('reads naturally', () => {
    const units = unitsFor(milk, rows)
    expect(formatAmount(416, units[1]!)).toBe('6.5 half gallons')
    expect(formatAmount(64, units[1]!)).toBe('1 half gallon')
    expect(describeAmount(416, units, 'hg')).toBe('6.5 half gallons (416 oz)')
    expect(unitLabel('box', 2)).toBe('boxes')
    expect(unitLabel('oz', 2)).toBe('oz')
    expect(unitLabel('each', 5)).toBe('each')
  })

  it('shows tiny costs with enough digits', () => {
    expect(formatMoney(19.2)).toBe('$19.20')
    expect(formatMoney(0.05)).toBe('$0.05')
    expect(formatMoney(0.0123)).toBe('$0.0123')
  })
})
