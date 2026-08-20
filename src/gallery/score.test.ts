import { describe, expect, it } from 'vitest'
import { byPopularity, popularity } from './score'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * The whole reason this file exists: a raw star count ranks by seniority. These check that the decay
 * actually does what it is for, rather than that the formula is the formula.
 */

describe('popularity', () => {
  it('rises with stars', () => {
    expect(popularity(10, DAY)).toBeGreaterThan(popularity(2, DAY))
  })

  it('falls with age at equal stars', () => {
    expect(popularity(10, HOUR)).toBeGreaterThan(popularity(10, 30 * DAY))
  })

  it('lets a good new patch overtake an old favourite', () => {
    // The point of the whole thing. Five stars today beats twenty from a year ago.
    const fresh = popularity(5, 6 * HOUR)
    const veteran = popularity(20, 365 * DAY)
    expect(fresh).toBeGreaterThan(veteran)
  })

  it('does not let a single star on a brand-new entry pin it to the top', () => {
    // Without the offset the denominator approaches zero and one star wins everything.
    const newborn = popularity(1, 0)
    const established = popularity(40, 12 * HOUR)
    expect(established).toBeGreaterThan(newborn)
  })

  it('gives an unstarred entry no score at all, however new', () => {
    expect(popularity(0, 0)).toBe(0)
  })

  it('treats a future timestamp as now rather than dividing by a negative age', () => {
    expect(popularity(3, -HOUR)).toBe(popularity(3, 0))
  })
})

describe('byPopularity', () => {
  const now = 1_000 * DAY

  it('orders highest score first', () => {
    const old = { stars: 20, createdAt: now - 365 * DAY }
    const fresh = { stars: 5, createdAt: now - 6 * HOUR }
    expect([old, fresh].sort((a, b) => byPopularity(a, b, now))[0]).toBe(fresh)
  })

  it('breaks a tie by recency, so equal entries do not shuffle between renders', () => {
    const older = { stars: 0, createdAt: now - 2 * DAY }
    const newer = { stars: 0, createdAt: now - DAY }
    expect([older, newer].sort((a, b) => byPopularity(a, b, now))[0]).toBe(newer)
    expect([newer, older].sort((a, b) => byPopularity(a, b, now))[0]).toBe(newer)
  })
})
