import { describe, expect, it } from 'vitest'
import { effectOr } from './effects'
import { fakeAudio } from './fakeAudio'
import { MAX_COMPRESS_ATTACK, MAX_RATIO, MIN_THRESHOLD, type FxParams } from '../types/patch'

/**
 * The compressor, checked as wiring and as values written.
 *
 * There is no arithmetic of ours in it — a native `DynamicsCompressorNode` does the work, the same node
 * the master bus has used as a limiter since the engine was written — so what can go wrong is what gets
 * written to it. Two things in particular: a unit conversion, since an attack is milliseconds everywhere
 * in this instrument and seconds in Web Audio; and four near-identical assignments, which is one line of
 * copy-paste away from one of them reading the wrong field.
 */

const params = (over: Partial<FxParams> = {}): FxParams =>
  ({ effect: 'compress', mix: 1, ...effectOr('compress').defaults, ...over }) as FxParams

function built(over: Partial<FxParams> = {}) {
  const fake = fakeAudio()
  const chain = effectOr('compress').create(fake.ctx)
  chain.update(params(over), { at: 0, bpm: 120 })
  return { fake, chain, node: fake.nodes('compressor')[0] }
}

const written = (node: Record<string, unknown>, key: string) =>
  (node[key] as { value: number }).value

describe('the compressor', () => {
  it('is one native node and nothing else', () => {
    // Which is the whole reason it was cheap. A shape of our own here would be a worse compressor than
    // the one the platform already ships and already limits the master with.
    const { fake } = built()
    expect(fake.nodes('compressor')).toHaveLength(1)
    expect(fake.nodes('shaper')).toHaveLength(0)
  })

  it('does nothing at a ratio of one, which is where it starts', () => {
    // Neutral at rest, like every other effect here. A ratio of one passes what it hears whatever the
    // threshold says, so the node can be dropped in and left alone without being a change.
    const { node } = built({ ratio: 1, threshold: 0 })
    expect(written(node, 'ratio')).toBe(1)
    expect(written(node, 'threshold')).toBe(0)
  })

  it('writes each control to its own parameter and to no other', () => {
    /*
     * Four values that are all numbers going to four parameters of one node. Every one is set to something
     * distinct, so a swapped pair is visible rather than cancelling out.
     */
    const { node } = built({ threshold: -24, ratio: 6, attack: 35, decay: 0.4 })
    expect(written(node, 'threshold')).toBeCloseTo(-24, 4)
    expect(written(node, 'ratio')).toBeCloseTo(6, 4)
    expect(written(node, 'release')).toBeCloseTo(0.4, 4)
  })

  it('converts the attack from milliseconds to seconds', () => {
    /*
     * The one unit conversion in the effect, and the sort that is invisible when it is wrong: an attack of
     * 35 written straight through would be thirty-five *seconds*, which is a compressor that never
     * engages within a pass — indistinguishable from one that is switched off.
     */
    expect(written(built({ attack: 35 }).node, 'attack')).toBeCloseTo(0.035, 6)
    expect(written(built({ attack: 0 }).node, 'attack')).toBeCloseTo(0, 6)
    expect(written(built({ attack: MAX_COMPRESS_ATTACK }).node, 'attack')).toBeCloseTo(0.1, 6)
  })

  it('keeps its knee soft, since that is the control it does not offer', () => {
    // Left off on purpose rather than forgotten: five sliders is where a compressor wants a manual of its
    // own, and a hard knee is a limiter — which the ratio already reaches on its own.
    expect(written(built().node, 'knee')).toBeGreaterThan(0)
  })

  it('clamps anything a hand-built patch or an older code could carry', () => {
    const wild = built({ threshold: 40, ratio: 400, attack: 9000, decay: 900 }).node
    expect(written(wild, 'threshold')).toBe(0)
    expect(written(wild, 'ratio')).toBe(MAX_RATIO)
    expect(written(wild, 'attack')).toBeCloseTo(MAX_COMPRESS_ATTACK / 1000, 6)

    const low = built({ threshold: -400, ratio: -3 }).node
    expect(written(low, 'threshold')).toBe(MIN_THRESHOLD)
    expect(written(low, 'ratio')).toBe(1)
  })

  it('hands over an AudioParam for all four of its controls', () => {
    // All four are real parameters on the node, so all four take a cable — a swept threshold being the one
    // worth having, since it is a compressor that tightens as something else gets louder.
    const { chain } = built()
    for (const key of ['threshold', 'ratio', 'attack', 'decay']) {
      expect(chain.paramFor?.(key) ?? null, key).not.toBeNull()
    }
    expect(chain.paramFor?.('cutoff') ?? null).toBeNull()
  })
})
