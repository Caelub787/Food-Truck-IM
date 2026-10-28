import { describe, expect, it } from 'vitest'
import { safeNext } from './urls'

describe('safeNext', () => {
  it('keeps links inside the app', () => {
    expect(safeNext('/people?x=1')).toBe('/people?x=1')
  })

  it('refuses links that leave the app', () => {
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext('/\\evil.example')).toBe('/')
    expect(safeNext(null)).toBe('/')
  })
})
