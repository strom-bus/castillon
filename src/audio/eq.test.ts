import { describe, expect, it } from 'vitest'
import { effectOr } from './effects'
import { fakeAudio } from './fakeAudio'
import { MAX_EQ_DB, type FxParams } from '../types/patch'

/**
 * The three-band EQ, checked as wiring.
 *
 * There is no arithmetic of ours in this one — three `BiquadFilterNode`s do the work — so there is
 * nothing to test the way the folder's curve or the resonator's loop could be tested. What can go wrong
 * is what the nodes are and what is written to them, and both are observable without any sound: a shelf
 * built as a low-pass would still filter at nought decibels, and an EQ that filtered when flat would be
 * the one effect here that is not a wire until it is asked to be.
 */

const params = (over: Partial<FxParams> = {}): FxParams =>
  ({ effect: 'eq', mix: 1, ...effectOr('eq').defaults, ...over }) as FxParams

/** Builds the chain over a recording context and hands back the biquads it made, in order. */
function built(over: Partial<FxParams> = {}) {
  const fake = fakeAudio()
  const chain = effectOr('eq').create(fake.ctx)
  chain.update(params(over), { at: 0, bpm: 120 })
  return { fake, chain, biquads: fake.nodes('biquad') }
}

/** The last value written to a parameter of one of those nodes. */
const written = (node: Record<string, unknown>, key: string): number =>
  (node[key] as { value: number }).value

describe('the three-band EQ', () => {
  it('is a shelf, a bell and a shelf, in that order', () => {
    /*
     * The types are the whole of "flat is a wire". A shelving or peaking biquad at nought decibels is
     * exactly unity; a low-pass at nought decibels is still a low-pass, and an EQ that quietly filtered
     * when every band was flat would break the promise every effect here makes.
     */
    const { biquads } = built()
    expect(biquads).toHaveLength(3)
    expect(biquads.map((node) => node.type)).toEqual(['lowshelf', 'peaking', 'highshelf'])
  })

  it('hinges its shelves where a shelf belongs, and does not move them', () => {
    // Fixed, and fixed *low and high*: a shelf at 250 Hz is under the body of almost everything and above
    // the rumble, and one at 3 kHz is where air lives. Aiming them would double the controls.
    const [low, , high] = built().biquads
    expect(written(low, 'frequency')).toBe(250)
    expect(written(high, 'frequency')).toBe(3000)

    const moved = built({ cutoff: 8000 }).biquads
    expect(written(moved[0], 'frequency')).toBe(250)
    expect(written(moved[2], 'frequency')).toBe(3000)
  })

  it('aims the bell wherever the Mid Hz control is put', () => {
    // The one frequency that does move, because a mid band you cannot aim is not a mid band.
    const [, mid] = built({ cutoff: 700 }).biquads
    expect(written(mid, 'frequency')).toBeCloseTo(700, 0)
  })

  it('keeps the bell broad, so a boost is a tone and not a resonance', () => {
    // What separates this from the Filter effect. A narrow bell rings; a wide one changes the colour.
    const [, mid] = built().biquads
    expect(written(mid, 'Q')).toBeLessThan(2)
    expect(written(mid, 'Q')).toBeGreaterThan(0.3)
  })

  it('is flat at rest, in the nodes and not only in the numbers', () => {
    const [low, mid, high] = built().biquads
    for (const [node, name] of [
      [low, 'low'],
      [mid, 'mid'],
      [high, 'high'],
    ] as const) {
      expect(written(node, 'gain'), name).toBe(0)
    }
  })

  it('writes each band to its own filter and to no other', () => {
    /*
     * The mistake this catches is one line of copy-paste: three near-identical assignments where one
     * reads the wrong field. Every band set to a different value, so a swap is visible rather than
     * cancelling out.
     */
    const [low, mid, high] = built({ low: -6, mid: 3, high: 12 }).biquads
    expect(written(low, 'gain')).toBeCloseTo(-6, 4)
    expect(written(mid, 'gain')).toBeCloseTo(3, 4)
    expect(written(high, 'gain')).toBeCloseTo(12, 4)
  })

  it('clamps a band that came from somewhere careless', () => {
    // A hand-built patch or an older code can carry anything, and thirty decibels of boost is not an EQ
    // setting, it is a distortion nobody asked for.
    const [low, , high] = built({ low: 40, high: -99 }).biquads
    expect(written(low, 'gain')).toBe(MAX_EQ_DB)
    expect(written(high, 'gain')).toBe(-MAX_EQ_DB)
  })

  it('hands over an AudioParam for every one of its four controls', () => {
    /*
     * All four are real parameters on a biquad, which is what makes them the cheapest modulation
     * destinations here — a signal added to a gain rather than a table rebuilt on a tick. An EQ whose
     * bands could not be automated would be the dull effect and nothing else.
     */
    const { chain } = built()
    for (const key of ['low', 'mid', 'high', 'cutoff']) {
      expect(chain.paramFor?.(key) ?? null, key).not.toBeNull()
    }
    expect(chain.paramFor?.('decay') ?? null).toBeNull()
  })

  it('has no tone stage of its own, because it is one', () => {
    // Every other effect here builds a fourth filter for `cutoff` to drive. Doing that as well would be
    // a band nobody asked for and a control meaning two things in one panel.
    expect(built().biquads).toHaveLength(3)
  })
})
