import { describe, expect, it } from 'vitest'
import { friendlyError } from './errors'

describe('friendlyError', () => {
  it('rewrites common login errors in plain words', () => {
    expect(friendlyError(new Error('Invalid login credentials'))).toMatch(/don't match/)
    expect(friendlyError(new Error('Email not confirmed'))).toMatch(/confirm your email/)
    expect(friendlyError(new Error('Email link is invalid or has expired'))).toMatch(/expired/)
  })

  it('keeps messages that are already friendly', () => {
    expect(friendlyError(new Error('Please enter your business name.'))).toBe('Please enter your business name.')
  })

  it('has a fallback', () => {
    expect(friendlyError(null)).toBe('Something went wrong. Please try again.')
  })
})

describe('database errors', () => {
  it('explains common database problems', () => {
    expect(friendlyError({ message: 'duplicate key value violates unique constraint "trucks_name_idx"', code: '23505' })).toMatch(
      /already used/,
    )
    expect(
      friendlyError({ message: 'update or delete on table "places" violates foreign key constraint "x" on table "stock_levels"' }),
    ).toMatch(/Turn it off instead/)
    expect(friendlyError({ message: 'new row violates row-level security policy for table "trucks"' })).toMatch(/permission/)
  })
})
