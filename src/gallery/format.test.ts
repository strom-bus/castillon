import { describe, expect, it } from 'vitest'
import { countryOf, relativeAge } from './format'

describe('countryOf', () => {
  it('shows the two letters, in capitals', () => {
    expect(countryOf('de')).toBe('DE')
    expect(countryOf('CL')).toBe('CL')
  })

  it('shows nothing where Cloudflare could not tell', () => {
    // XX for unknown and T1 for Tor. Neither is a place, and printing them would look like one.
    expect(countryOf('XX')).toBe('')
    expect(countryOf('T1')).toBe('')
  })

  it('shows nothing rather than passing through whatever it was given', () => {
    expect(countryOf(null)).toBe('')
    expect(countryOf('')).toBe('')
    expect(countryOf('Germany')).toBe('')
    expect(countryOf('1')).toBe('')
  })
})

describe('relativeAge', () => {
  const now = 1_700_000_000_000
  const MINUTE = 60_000

  it('says just now for something that has only appeared', () => {
    expect(relativeAge(now, now)).toBe('just now')
  })

  it('counts up through minutes, hours and days', () => {
    expect(relativeAge(now - 5 * MINUTE, now)).toBe('5m ago')
    expect(relativeAge(now - 180 * MINUTE, now)).toBe('3h ago')
    expect(relativeAge(now - 60 * 48 * MINUTE, now)).toBe('2d ago')
  })

  it('does not count backwards for a timestamp from the future', () => {
    // Clocks disagree; a card should not offer to tell you about tomorrow.
    expect(relativeAge(now + 10 * MINUTE, now)).toBe('just now')
  })
})
