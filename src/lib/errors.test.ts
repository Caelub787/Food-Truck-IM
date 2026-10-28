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
