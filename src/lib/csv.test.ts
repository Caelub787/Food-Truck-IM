import { describe, expect, it } from 'vitest'
import { csvObjects, headerKey, parseCsv, toCsv } from './csv'

describe('csv', () => {
  it('reads quotes, commas, and line breaks inside quotes', () => {
    const text = '\uFEFFName,Note\r\n"Milk, whole","Says ""hi""\nthere"\r\nCups,\r\n\r\n'
    expect(parseCsv(text)).toEqual([
      ['Name', 'Note'],
      ['Milk, whole', 'Says "hi"\nthere'],
      ['Cups', ''],
    ])
  })

  it('matches headers however they are written', () => {
    expect(headerKey(' Count Unit Size ')).toBe('count_unit_size')
    expect(headerKey('Cost ($)')).toBe('cost')
    expect(csvObjects('Name,Base Unit\nMilk,oz\n')).toEqual([{ name: 'Milk', base_unit: 'oz' }])
  })

  it('writes cells that need quotes', () => {
    expect(toCsv([['a,b', 'say "x"', 3, null]])).toBe('"a,b","say ""x""",3,\r\n')
  })
})
