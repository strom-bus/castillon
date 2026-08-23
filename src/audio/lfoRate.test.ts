import { describe, expect, it } from 'vitest'
import { MOD_BEATS, amountFor, rateOf, targetsFor } from './modulation'

/**
 * Three things an LFO could not do, and each was missing for its own reason.
 */

describe('an LFO counted in beats', () => {
  /*
   * The echo has synced to the tempo since it existed and an LFO could only be set in hertz, so a wobble
   * in time at 120 was out of it at 128 — and the control most likely to want the grid was the one that
   * could not have it.
   */
  it('leaves a rate in hertz alone when it is not synced', () => {
    // Every patch made before this keeps exactly the rate it was given.
    expect(rateOf(3, 4, false, 120)).toBe(3)
    expect(rateOf(3, undefined, true, 120)).toBe(3)
  })

  it('turns beats into hertz at the tempo', () => {
    // One cycle every four beats at 120 is one every two seconds.
    expect(rateOf(3, 4, true, 120)).toBeCloseTo(0.5, 6)
    // And every beat at 120 is twice a second.
    expect(rateOf(3, 1, true, 120)).toBeCloseTo(2, 6)
  })

  it('follows the tempo, which is the whole point of it', () => {
    const slow = rateOf(3, 4, true, 90)
    const fast = rateOf(3, 4, true, 180)
    expect(fast).toBeCloseTo(slow * 2, 6)
  })

  it('offers cycles long enough to be a shape rather than a texture', () => {
    // Something coming round every eight beats is a shape the music moves through. A list that stopped
    // at one beat would only offer textures, which is what the hertz slider already gives.
    expect(Math.max(...MOD_BEATS)).toBeGreaterThanOrEqual(16)
    expect(Math.min(...MOD_BEATS)).toBeLessThanOrEqual(0.5)
  })

  it('refuses to divide by nothing', () => {
    // A patch code or an older patch can carry a zero, and a rate of infinity is not a wobble.
    expect(rateOf(3, 0, true, 120)).toBe(3)
    expect(rateOf(3, 4, true, 0)).toBe(3)
  })
})

describe('a depth that can be negative', () => {
  /*
   * A modulation could only ever be *added* to what it pointed at, so an envelope could open a filter and
   * never close one, and two LFOs could not be set against each other. Inverting is the same modulation
   * read the other way round, so it belongs inside the number rather than beside it as a switch.
   */
  const cutoff = targetsFor('osc').find((one) => one.key === 'cutoff')!

  it('sweeps the other way below zero', () => {
    expect(amountFor(cutoff, -0.5)).toBeCloseTo(-amountFor(cutoff, 0.5), 6)
  })

  it('still means the same share of the span, whichever way it points', () => {
    expect(Math.abs(amountFor(cutoff, -1))).toBeCloseTo(amountFor(cutoff, 1), 6)
  })

  it('does nothing at all at zero, from either side', () => {
    // Compared by nearness rather than identity: `-0` is a distinct value to `Object.is` and the same
    // value to an `AudioParam`, and it is the parameter this is a claim about.
    expect(amountFor(cutoff, 0)).toBeCloseTo(0, 10)
    expect(amountFor(cutoff, -0)).toBeCloseTo(0, 10)
  })

  it('is bounded on both sides now, not only above', () => {
    // It clamped to [0, 1]. A depth of minus five would otherwise sweep five times the span.
    expect(amountFor(cutoff, -5)).toBeCloseTo(amountFor(cutoff, -1), 6)
    expect(amountFor(cutoff, 5)).toBeCloseTo(amountFor(cutoff, 1), 6)
  })
})
