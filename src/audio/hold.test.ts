import { describe, expect, it } from 'vitest'
import { defaultHoldParams, holdLetsThrough } from '../nodes/registry'
import { MAX_EVERY, type HoldParams } from '../types/patch'

/**
 * Which passes belong to a hold.
 *
 * The cascade has no bar, so a pass is the only thing that recurs — and this is the arithmetic that turns
 * counting them into a musical idea. Tested apart from the scheduler because it is a pure question about
 * numbers, and because the thing that would go wrong in it is off-by-one in three different places.
 */

const at = (params: Partial<HoldParams>, laps: number) =>
  Array.from({ length: laps }, (_, i) =>
    holdLetsThrough({ ...defaultHoldParams(), ...params }, i + 1),
  )

describe('a hold counting passes', () => {
  it('lets everything through until it is asked not to', () => {
    // Where it starts. Dropping one into a chain has to be no change at all, the same promise a warp
    // makes — otherwise adding one is an edit to undo rather than an edit to make.
    expect(at({}, 6)).toEqual([true, true, true, true, true, true])
  })

  it('takes every other pass at two', () => {
    expect(at({ every: 2, offset: 1 }, 6)).toEqual([true, false, true, false, true, false])
  })

  it('takes the other half at the same run, which is how two branches alternate', () => {
    /*
     * Alternation with no feature of its own: two holds over the same run, disagreeing about which
     * passes are theirs. Asserted as the *complement*, because that is the property that makes it
     * alternation rather than two things that merely both happen sometimes.
     */
    const first = at({ every: 2, offset: 1 }, 8)
    const second = at({ every: 2, offset: 2 }, 8)
    expect(second).toEqual(first.map((taken) => !taken))
  })

  it('counts from one, so the first pass is 1 and not 0', () => {
    /*
     * A musician writes the first of every two as 1:2. Counting from zero would put the same idea on
     * screen as 0:2, which is the arithmetic showing through — and the modulo has to be taken twice,
     * since `lap - offset` goes negative on the early passes and JavaScript keeps the sign there.
     */
    expect(holdLetsThrough({ every: 2, offset: 1, chance: 1 }, 1)).toBe(true)
    expect(holdLetsThrough({ every: 4, offset: 3, chance: 1 }, 1)).toBe(false)
    expect(holdLetsThrough({ every: 4, offset: 3, chance: 1 }, 3)).toBe(true)
  })

  it('divides a longer run without drifting', () => {
    const taken = at({ every: 4, offset: 2 }, 12)
    expect(taken.map((one, i) => (one ? i + 1 : 0)).filter(Boolean)).toEqual([2, 6, 10])
  })

  it('cannot be set to a pass its own run never reaches', () => {
    /*
     * A place beyond the run would be a condition that can never be met — a node silent for ever with
     * nothing saying why. Clamped where it is read rather than only where it is typed, so a patch code
     * or an older patch cannot carry one in.
     */
    expect(at({ every: 2, offset: 9 }, 4)).toEqual(at({ every: 2, offset: 2 }, 4))
  })

  it('never counts over a run longer than it can hold', () => {
    const beyond = at({ every: MAX_EVERY * 4, offset: 1 }, MAX_EVERY + 1)
    expect(beyond[0]).toBe(true)
    // Clamped to the longest run, so the pattern comes round again within it rather than never.
    expect(beyond[MAX_EVERY]).toBe(true)
  })

  it('is unmoved by a fractional or absent setting', () => {
    // A patch code stores whole numbers, but a hand-built patch need not.
    expect(holdLetsThrough({ every: 2.4, offset: 1.4, chance: 1 }, 3)).toBe(true)
    expect(holdLetsThrough({} as HoldParams, 7)).toBe(true)
  })
})
